// browser-shell core — shell 語法直譯層 + builtin registry
// 零 import: 依賴(parser/指令本體/fs/glob)全由 initDeps(ctx) 注入,
// bundler-agnostic。單一模組實例只能綁一組依賴(再呼叫會整組替換)。
let parse, shell, fs, fg;
export function initDeps(ctx) {
  parse = ctx.parse;
  shell = ctx.shell;
  fs = ctx.fs;
  fg = ctx.fg;
}

// ---------- context ----------
export function createContext() {
  return {
    vars: { HOME: "/home/web", PATH: "/bin" },
    funcs: {},
    commands: {},
    positional: [],
    scopes: [],
    lastCode: 0,
    esh: null // base.js 於 esh(ctx) 時填 {fs, cwd} — 供自訂指令碰檔案 (0.3.0)
  };
}

// ---------- $(( )) 算術 (babel-style AST from bash-parser) ----------
function evalArith(n, ctx) {
  switch(n.type) {
    case "NumericLiteral": return n.value;
    case "Identifier": {
      const v = Number(ctx.vars[n.name]);
      return isNaN(v) ? 0 : Math.trunc(v);
    }
    case "ParenthesizedExpression": return evalArith(n.expression, ctx);
    case "UnaryExpression": {
      const v = evalArith(n.argument, ctx);
      if(n.operator === "-") return -v;
      if(n.operator === "+") return v;
      if(n.operator === "!") return v === 0 ? 1 : 0;
      if(n.operator === "~") return ~v;
      break;
    }
    case "BinaryExpression": {
      const l = evalArith(n.left, ctx), r = evalArith(n.right, ctx);
      switch(n.operator) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": if(r === 0) throw new Error("division by zero"); return Math.trunc(l / r);
        case "%": if(r === 0) throw new Error("division by zero"); return l % r;
        case "<": return l < r ? 1 : 0;
        case ">": return l > r ? 1 : 0;
        case "<=": return l <= r ? 1 : 0;
        case ">=": return l >= r ? 1 : 0;
        case "==": return l === r ? 1 : 0;
        case "!=": return l !== r ? 1 : 0;
        case "&": return l & r;
        case "|": return l | r;
        case "^": return l ^ r;
        case "<<": return l << r;
        case ">>": return l >> r;
      }
      break;
    }
    case "LogicalExpression": {
      const l = evalArith(n.left, ctx);
      if(n.operator === "&&") return l !== 0 && evalArith(n.right, ctx) !== 0 ? 1 : 0;
      if(n.operator === "||") return l !== 0 || evalArith(n.right, ctx) !== 0 ? 1 : 0;
      break;
    }
    case "ConditionalExpression":
      return evalArith(n.test, ctx) !== 0 ? evalArith(n.consequent, ctx) : evalArith(n.alternate, ctx);
    case "AssignmentExpression": {
      const name = n.left.name;
      let v = evalArith(n.right, ctx);
      if(n.operator !== "=") {
        const cur = Number(ctx.vars[name]) || 0;
        const op = n.operator.slice(0, -1);
        v = op === "+" ? cur + v : op === "-" ? cur - v : op === "*" ? cur * v
          : op === "/" ? Math.trunc(cur / v) : op === "%" ? cur % v : v;
      }
      ctx.vars[name] = String(v);
      return v;
    }
    case "UpdateExpression": {
      const name = n.argument.name;
      const cur = Number(ctx.vars[name]) || 0;
      const nv = n.operator === "++" ? cur + 1 : cur - 1;
      ctx.vars[name] = String(nv);
      return n.prefix ? nv : cur;
    }
  }
  throw new Error("arith: 不支援的節點 " + n.type);
}

// control flow 訊號 (以 exception 逐層上拋, 由 For/While/Function 捕捉)
function BreakSig(n) { this.n = n || 1; }
function ContinueSig(n) { this.n = n || 1; }
function ReturnSig(code) { this.code = code || 0; }

// ---------- word expansion ----------
// 把 word 拆成 segments: {text, quoted, expansion}
// 追蹤雙引號區域 (單引號 parser 已剝除), expansion 於此解析成值
async function wordSegments(word, ctx) {
  const src = word.text;
  // bash-parser bug: 換行後的指令 Word 會殘留前一行的幽靈 expansion,
  // loc 為負數或指錯位置 — 只接受 loc 合法且該處確為 $ 或 ` 的 expansion
  const exps = (word.expansion || []).filter((e) =>
    e.loc && e.loc.start >= 0 && e.loc.end >= e.loc.start && e.loc.end < src.length &&
    (src.charAt(e.loc.start) === "$" || src.charAt(e.loc.start) === "`")
  ).sort((a, b) => a.loc.start - b.loc.start);
  const segments = [];
  let pos = 0, inDouble = false;

  function literal(chunk) {
    let cur = "";
    for(let i = 0; i < chunk.length; i++) {
      const c = chunk.charAt(i);
      if(c === "\"") {
        if(cur) { segments.push({ text: cur, quoted: inDouble, expansion: false }); cur = ""; }
        // 進出引號本身也算「有引號的空片段」, 讓 echo "" 產生空 argv
        segments.push({ text: "", quoted: true, expansion: false });
        inDouble = !inDouble;
      } else cur += c;
    }
    if(cur) segments.push({ text: cur, quoted: inDouble, expansion: false });
  }

  for(const e of exps) {
    literal(src.slice(pos, e.loc.start));
    let v = "", list = null;
    if(e.type === "ParameterExpansion") {
      if(e.parameter === "?") v = String(ctx.lastCode);
      else if(e.parameter === "@" || e.parameter === "*") {
        v = ctx.positional.join(" ");
        if(inDouble && e.parameter === "@") list = ctx.positional.slice();
      }
      else if(e.kind === "positional" || /^\d+$/.test(String(e.parameter)))
        v = ctx.positional[Number(e.parameter) - 1] !== undefined ? ctx.positional[Number(e.parameter) - 1] : "";
      else if(e.parameter === "#") v = String(ctx.positional.length);
      else v = ctx.vars[e.parameter] !== undefined ? String(ctx.vars[e.parameter]) : "";
    } else if(e.type === "CommandExpansion") {
      const r = await evalNode(e.commandAST, ctx, null);
      v = (r.stdout || "").replace(/\n+$/, "");
    } else if(e.type === "ArithmeticExpansion") {
      v = String(evalArith(e.arithmeticAST, ctx));
    }
    segments.push({ text: v, quoted: inDouble, expansion: true, list });
    pos = e.loc.end + 1;
  }
  literal(src.slice(pos));
  return segments;
}

// 單一字串 (redirect 目標、賦值右側): 不 field split、不 glob
async function expandString(word, ctx) {
  const segs = await wordSegments(word, ctx);
  let t = segs.map((s) => s.text).join("");
  if(word.text.charAt(0) === "~" && (t === "~" || t.slice(0, 2) === "~/"))
    t = ctx.vars.HOME + t.slice(1);
  return t;
}

// argv 用: 未加引號的 expansion 結果做 field splitting, 之後逐欄 glob
async function expandWordToFields(word, ctx) {
  const segs = await wordSegments(word, ctx);
  const fields = [];
  let cur = null;
  const ensure = () => { if(!cur) cur = { pattern: "", hasGlob: false }; };
  const flush = () => { if(cur) { fields.push(cur); cur = null; } };
  const addPiece = (text, quoted) => {
    ensure();
    cur.pattern += text;
    if(!quoted && /[*?[]/.test(text)) cur.hasGlob = true;
  };

  // IFS 決定未加引號 expansion 的切欄字元 (IFS= 空字串則不切)
  const ifs = ctx.vars.IFS !== undefined ? ctx.vars.IFS : " \t\n";
  const splitter = ifs === "" ? null : new RegExp("[" + ifs.replace(/[\\\]^-]/g, "\\$&") + "]+");

  segs.forEach((seg) => {
    if(seg.expansion && !seg.quoted) {
      const parts = splitter ? seg.text.split(splitter) : [seg.text];
      if(parts.length === 1 && parts[0] === "") return; // 空展開: 不成欄也不切欄
      parts.forEach((p, i) => {
        if(i > 0) flush();
        if(p === "") { if(i === 0) flush(); return; }
        addPiece(p, false);
      });
    } else if(seg.quoted) {
      if(seg.list) {
        // "$@": 每個參數獨立成欄, 前後可與相鄰片段黏合
        seg.list.forEach((p, i) => {
          if(i > 0) flush();
          ensure();
          cur.pattern += p;
        });
      } else {
        ensure();
        cur.pattern += seg.text;
      }
    } else if(seg.text !== "") {
      addPiece(seg.text, false);
    }
  });
  flush();

  const out = [];
  fields.forEach((f, idx) => {
    let t = f.pattern;
    if(idx === 0 && word.text.charAt(0) === "~" && (t === "~" || t.slice(0, 2) === "~/"))
      t = ctx.vars.HOME + t.slice(1);
    if(f.hasGlob) {
      const matches = fg.sync(t, { cwd: process.cwd(), onlyFiles: false, dot: false });
      if(matches.length) { out.push.apply(out, matches.sort()); return; }
    }
    out.push(t);
  });
  return out;
}

// ---------- builtins ----------
function norm(o) {
  if(o === null || o === undefined) return { stdout: "", stderr: "", code: 0 };
  if(typeof o === "object" && o.stdout !== undefined)
    return { stdout: String(o.stdout), stderr: o.stderr ? String(o.stderr) : "", code: Number(o.code) || 0 };
  if(Array.isArray(o)) return { stdout: o.join("\n"), stderr: "", code: 0 };
  return { stdout: String(o), stderr: "", code: 0 };
}

function splitFlags(args) {
  const flags = [];
  let i = 0;
  while(i < args.length && args[i].charAt(0) === "-" && args[i] !== "-") { flags.push(args[i]); i++; }
  return { flags, rest: args.slice(i) };
}

function pipeSrc(stdin) { return shell.ShellString(stdin === null ? "" : stdin); }

function parseSedExpr(expr) {
  if(expr.charAt(0) !== "s" || expr.length < 4) return null;
  const d = expr.charAt(1);
  const parts = [];
  let cur = "", esc = false;
  for(let i = 2; i < expr.length; i++) {
    const c = expr.charAt(i);
    if(esc) { cur += (c === d ? "" : "\\") + c; esc = false; }
    else if(c === "\\") esc = true;
    else if(c === d) { parts.push(cur); cur = ""; }
    else cur += c;
  }
  parts.push(cur);
  if(parts.length < 2) return null;
  const mods = parts[2] || "";
  let re = "";
  if(mods.indexOf("g") >= 0) re += "g";
  if(mods.indexOf("i") >= 0) re += "i";
  return { regex: new RegExp(parts[0], re), replacement: parts[1] };
}

const builtins = {
  echo: (args) => {
    let noNewline = false;
    if(args[0] === "-n") { noNewline = true; args = args.slice(1); }
    return { stdout: args.join(" ") + (noNewline ? "" : "\n"), stderr: "", code: 0 };
  },
  pwd: () => norm(String(shell.pwd())),
  cd: (args, stdin, ctx) => {
    const r = shell.cd(args.length ? args[0] : ctx.vars.HOME);
    return { stdout: "", stderr: r.stderr || "", code: r.code || 0 };
  },
  cat: (args, stdin) => {
    const { flags, rest } = splitFlags(args);
    if(!rest.length) {
      let s = stdin === null ? "" : stdin;
      if(flags.indexOf("-n") >= 0)
        s = s.replace(/\n$/, "").split("\n").map((l, i) => (i + 1) + "\t" + l).join("\n") + "\n";
      return { stdout: s, stderr: "", code: 0 };
    }
    return norm(shell.cat.apply(shell, flags.concat(rest)));
  },
  grep: (args, stdin) => {
    const { flags, rest } = splitFlags(args);
    const fstr = flags.length ? flags.join("").replace(/-/g, "") : null;
    const a = fstr ? ["-" + fstr] : [];
    if(rest.length > 1) return norm(shell.grep.apply(shell, a.concat(rest)));
    return norm(pipeSrc(stdin).grep.apply(pipeSrc(stdin), a.concat(rest)));
  },
  sed: (args, stdin) => {
    const { flags, rest } = splitFlags(args);
    const e = parseSedExpr(rest[0] || "");
    if(!e) return { stdout: "", stderr: "sed: 只支援 s/pat/rep/[gi] 運算式", code: 1 };
    const files = rest.slice(1);
    const a = flags.concat([e.regex, e.replacement]);
    if(files.length) return norm(shell.sed.apply(shell, a.concat(files)));
    return norm(pipeSrc(stdin).sed.apply(pipeSrc(stdin), a));
  },
  sort: (args, stdin) => {
    const { flags, rest } = splitFlags(args);
    if(rest.length) return norm(shell.sort.apply(shell, flags.concat(rest)));
    return norm(pipeSrc(stdin).sort.apply(pipeSrc(stdin), flags));
  },
  head: (args, stdin) => headTail("head", args, stdin),
  tail: (args, stdin) => headTail("tail", args, stdin),
  uniq: (args, stdin) => {
    const { flags, rest } = splitFlags(args);
    if(rest.length) return norm(shell.uniq.apply(shell, flags.concat(rest)));
    return norm(pipeSrc(stdin).uniq.apply(pipeSrc(stdin), flags));
  },
  wc: (args, stdin) => {
    const { flags, rest } = splitFlags(args);
    let s = "";
    if(rest.length) rest.forEach((f) => { s += String(shell.cat(f)); });
    else s = stdin === null ? "" : stdin;
    const lines = (s.match(/\n/g) || []).length;
    const words = s.split(/\s+/).filter(Boolean).length;
    const chars = s.length;
    let out;
    if(flags.indexOf("-l") >= 0) out = String(lines);
    else if(flags.indexOf("-w") >= 0) out = String(words);
    else if(flags.indexOf("-c") >= 0) out = String(chars);
    else out = lines + " " + words + " " + chars;
    return { stdout: out + "\n", stderr: "", code: 0 };
  },
  test: (args) => testCmd(args),
  "[": (args) => {
    if(args[args.length - 1] !== "]") return { stdout: "", stderr: "[: missing ]", code: 2 };
    return testCmd(args.slice(0, -1));
  },
  "break": (args) => { throw new BreakSig(Number(args[0]) || 1); },
  "continue": (args) => { throw new ContinueSig(Number(args[0]) || 1); },
  "return": (args) => { throw new ReturnSig(Number(args[0]) || 0); },
  "true": () => ({ stdout: "", stderr: "", code: 0 }),
  "false": () => ({ stdout: "", stderr: "", code: 1 }),
  ":": () => ({ stdout: "", stderr: "", code: 0 }),
  "local": (args, stdin, ctx) => {
    const frame = ctx.scopes[ctx.scopes.length - 1];
    if(!frame) return { stdout: "", stderr: "local: 只能在 function 內使用", code: 1 };
    args.forEach((a) => {
      const i = a.indexOf("=");
      const k = i >= 0 ? a.slice(0, i) : a;
      if(!(k in frame))
        frame[k] = Object.prototype.hasOwnProperty.call(ctx.vars, k) ? [true, ctx.vars[k]] : [false];
      ctx.vars[k] = i >= 0 ? a.slice(i + 1) : "";
    });
    return { stdout: "", stderr: "", code: 0 };
  },
  "export": (args, stdin, ctx) => {
    args.forEach((a) => {
      const i = a.indexOf("=");
      if(i >= 0) ctx.vars[a.slice(0, i)] = a.slice(i + 1);
    });
    return { stdout: "", stderr: "", code: 0 };
  },
  unset: (args, stdin, ctx) => {
    args.forEach((a) => { delete ctx.vars[a]; });
    return { stdout: "", stderr: "", code: 0 };
  },
  env: (args, stdin, ctx) => {
    const out = Object.keys(ctx.vars).map((k) => k + "=" + ctx.vars[k]).join("\n");
    return { stdout: out + "\n", stderr: "", code: 0 };
  }
};

// ---------- 自訂指令 ----------
// 簽名同 builtin: (argv, stdin, ctx) → {stdout, stderr, code}
// 寬鬆回傳: 字串視為 stdout(code 0), undefined 視為空輸出成功;
// 可為 async function / 回傳 Promise (evaluator 為 async, 會等待;
// reject 轉為 stderr + code 1)。
// per-shell 註冊掛在 ctx.commands(經由 base.js 的 registerCommand);
// 此處 globalCommands 為全域 registry — 同 realm 所有 shell 共用, 慎用。
// 查找順序: shell function → ctx.commands → globalCommands → builtins。
const globalCommands = {};

export function commandMap(name, fn) {
  const map = (typeof name === "string") ? { [name]: fn } : (name || {});
  Object.keys(map).forEach((k) => {
    if(typeof map[k] !== "function")
      throw new Error("registerCommand: '" + k + "' 不是 function");
  });
  return map;
}

// 全域註冊: registerCommand(name, fn) 或 registerCommand({name: fn, ...})
export function registerCommand(name, fn) {
  Object.assign(globalCommands, commandMap(name, fn));
}

function normalizeCmdResult(r) {
  if(typeof r === "string") return { stdout: r, stderr: "", code: 0 };
  if(!r) return { stdout: "", stderr: "", code: 0 };
  return {
    stdout: r.stdout === undefined ? "" : String(r.stdout),
    stderr: r.stderr === undefined ? "" : String(r.stderr),
    code: Number(r.code) || 0
  };
}

async function callBuiltin(name, argv, stdin, ctx) {
  if(ctx.funcs[name]) return callFunction(ctx.funcs[name], argv, ctx, stdin);
  const custom = (ctx.commands && ctx.commands[name]) || globalCommands[name];
  const fn = custom || builtins[name];
  if(!fn) return { stdout: "", stderr: name + ": command not found", code: 127 };
  try {
    const r = await fn(argv, stdin, ctx); // 自訂指令可回傳 Promise (async fn)
    return custom ? normalizeCmdResult(r) : r;
  }
  catch(e) {
    if(e instanceof BreakSig || e instanceof ContinueSig || e instanceof ReturnSig) throw e;
    return { stdout: "", stderr: name + ": " + e.message, code: 1 };
  }
}

builtins.xargs = async (args, stdin, ctx) => {
  let n = 0, perLine = false, placeholder = null;
  let i = 0;
  for(; i < args.length; i++) {
    if(args[i] === "-n") { n = Number(args[i + 1]); i++; }
    else if(args[i].slice(0, 2) === "-n" && args[i].length > 2) n = Number(args[i].slice(2));
    else if(args[i] === "-L") { perLine = true; i++; }
    else if(args[i] === "-I") { placeholder = args[i + 1]; perLine = true; i++; }
    else break;
  }
  const cmd = args[i] || "echo";
  const base = args.slice(i + 1);
  const input = (stdin === null ? "" : stdin).replace(/\n+$/, "");
  if(!input) return { stdout: "", stderr: "", code: 0 };

  const batches = [];
  if(perLine) {
    input.split("\n").forEach((line) => { if(line.trim()) batches.push([line.trim()]); });
  } else {
    const tokens = input.split(/\s+/).filter(Boolean);
    if(n > 0) for(let j = 0; j < tokens.length; j += n) batches.push(tokens.slice(j, j + n));
    else batches.push(tokens);
  }

  let out = "", errs = [], worst = 0;
  for(const batch of batches) {
    let argv;
    if(placeholder) argv = base.map((a) => a.split(placeholder).join(batch[0]));
    else argv = base.concat(batch);
    const r = await callBuiltin(cmd, argv, null, ctx);
    if(r.stdout) out += r.stdout + (r.stdout.charAt(r.stdout.length - 1) === "\n" ? "" : "\n");
    if(r.stderr) errs.push(r.stderr);
    if(r.code > worst) worst = r.code;
  }
  return { stdout: out, stderr: errs.join("\n"), code: worst };
};

// 直接轉送 shelljs 的檔案系統指令 (dash 選項由 shelljs 自行解析)
["ls", "find", "mkdir", "rm", "cp", "mv", "touch", "chmod", "ln"].forEach((c) => {
  builtins[c] = (args) => norm(shell[c].apply(shell, args));
});

function headTail(which, args, stdin) {
  let n = 10;
  const files = [];
  for(let i = 0; i < args.length; i++) {
    if(args[i] === "-n") { n = Number(args[i + 1]); i++; }
    else if(args[i].slice(0, 2) === "-n") n = Number(args[i].slice(2));
    else files.push(args[i]);
  }
  const opt = { "-n": n };
  if(files.length) return norm(shell[which].apply(shell, [opt].concat(files)));
  const src = pipeSrc(stdin);
  return norm(src[which].call(src, opt));
}

function testCmd(args) {
  let ok = false;
  if(args.length === 2 && args[0].charAt(0) === "-") {
    if("-z" === args[0]) ok = args[1].length === 0;
    else if("-n" === args[0]) ok = args[1].length > 0;
    else ok = !!shell.test(args[0], args[1]);
  } else if(args.length === 3 && args[1] === "=") ok = args[0] === args[2];
  else if(args.length === 3 && args[1] === "!=") ok = args[0] !== args[2];
  else if(args.length === 3 && /^-(lt|le|gt|ge|eq|ne)$/.test(args[1])) {
    const l = Number(args[0]), r = Number(args[2]);
    const op = args[1];
    ok = op === "-lt" ? l < r : op === "-le" ? l <= r : op === "-gt" ? l > r
      : op === "-ge" ? l >= r : op === "-eq" ? l === r : l !== r;
  }
  else if(args.length === 1) ok = args[0].length > 0;
  return { stdout: "", stderr: "", code: ok ? 0 : 1 };
}

// ---------- evaluator ----------
async function applyAssignments(list, ctx) {
  for(const a of list) {
    const s = await expandString(a, ctx);
    const i = s.indexOf("=");
    ctx.vars[s.slice(0, i)] = s.slice(i + 1);
  }
}

async function evalCommand(node, ctx, stdin) {
  const assignments = [], redirects = [];
  (node.prefix || []).concat(node.suffix || []).forEach((x) => {
    if(x.type === "Redirect") redirects.push(x);
    else if(x.type === "AssignmentWord") assignments.push(x);
  });
  if(!node.name) {
    await applyAssignments(assignments, ctx);
    return { stdout: "", stderr: "", code: 0 };
  }
  // 暫時性賦值 (VAR=x cmd)
  const saved = {};
  for(const a of assignments) {
    const s = await expandString(a, ctx);
    const i = s.indexOf("=");
    const k = s.slice(0, i);
    saved[k] = ctx.vars[k];
    ctx.vars[k] = s.slice(i + 1);
  }

  let argv = await expandWordToFields(node.name, ctx);
  for(const x of (node.suffix || [])) {
    if(x.type === "Word") argv = argv.concat(await expandWordToFields(x, ctx));
  }

  let input = stdin;
  for(const r of redirects) {
    if(r.op.text === "<") {
      const target = await expandString(r.file, ctx);
      try { input = String(fs.readFileSync(target)); }
      catch(e) { input = ""; }
      if(heredocExpand.has(target))
        input = input.replace(/\$\{(\w+)\}|\$(\w+)/g, (mm, a, b) => {
          const k = a || b;
          return ctx.vars[k] !== undefined ? ctx.vars[k] : "";
        });
    }
  }

  let res = await callBuiltin(argv[0], argv.slice(1), input, ctx);

  for(const r of redirects) {
    const target = await expandString(r.file, ctx);
    const isErr = r.numberIo && r.numberIo.text === "2";
    const content = isErr ? res.stderr : res.stdout;
    if(r.op.text === ">") { shell.ShellString(content).to(target); }
    else if(r.op.text === ">>") { shell.ShellString(content).toEnd(target); }
    else continue;
    if(isErr) res.stderr = ""; else res.stdout = "";
  }

  Object.keys(saved).forEach((k) => {
    if(saved[k] === undefined) delete ctx.vars[k];
    else ctx.vars[k] = saved[k];
  });
  return res;
}

async function callFunction(body, argv, ctx, stdin) {
  const saved = ctx.positional;
  ctx.positional = argv;
  ctx.scopes.push({});
  try {
    return await evalNode(body, ctx, stdin);
  } catch(e) {
    if(e instanceof ReturnSig) return { stdout: "", stderr: "", code: e.code };
    throw e;
  } finally {
    const frame = ctx.scopes.pop();
    Object.keys(frame).forEach((k) => {
      if(frame[k][0]) ctx.vars[k] = frame[k][1];
      else delete ctx.vars[k];
    });
    ctx.positional = saved;
  }
}

function globToRegExp(pat) {
  let re = "";
  for(let i = 0; i < pat.length; i++) {
    const c = pat.charAt(i);
    if(c === "*") re += ".*";
    else if(c === "?") re += ".";
    else if("\\^$.|+()[]{}".indexOf(c) >= 0 && c !== "[" && c !== "]") re += "\\" + c;
    else if(c === "[" || c === "]") re += c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

const MAX_LOOP = 100000;

function concatRes(a, b) {
  let out = a.stdout;
  if(out && out.charAt(out.length - 1) !== "\n" && b.stdout) out += "\n";
  return { stdout: out + b.stdout, stderr: [a.stderr, b.stderr].filter(Boolean).join("\n"), code: b.code };
}

async function evalNode(node, ctx, stdin) {
  switch(node.type) {
    case "Script":
    case "CompoundList": {
      let acc = { stdout: "", stderr: "", code: 0 };
      for(const c of (node.commands || [])) {
        const r = await evalNode(c, ctx, null);
        ctx.lastCode = r.code;
        acc = concatRes(acc, r);
      }
      return acc;
    }
    case "LogicalExpression": {
      const left = await evalNode(node.left, ctx, null);
      ctx.lastCode = left.code;
      const runRight = node.op === "and" ? left.code === 0 : left.code !== 0;
      if(!runRight) return left;
      const right = await evalNode(node.right, ctx, null);
      ctx.lastCode = right.code;
      return concatRes(left, right);
    }
    case "Pipeline": {
      let cur = stdin, res = { stdout: "", stderr: "", code: 0 }, errs = [];
      for(const c of node.commands) {
        res = await evalNode(c, ctx, cur);
        if(res.stderr) errs.push(res.stderr);
        cur = res.stdout;
      }
      ctx.lastCode = res.code;
      return { stdout: res.stdout, stderr: errs.join("\n"), code: res.code };
    }
    case "Command":
      return evalCommand(node, ctx, stdin);
    case "If": {
      const cond = await evalNode(node.clause, ctx, null);
      ctx.lastCode = cond.code;
      let branch = { stdout: "", stderr: "", code: cond.code === 0 ? 0 : ctx.lastCode };
      if(cond.code === 0) branch = await evalNode(node.then, ctx, null);
      else if(node.else) branch = await evalNode(node.else, ctx, null);
      else branch = { stdout: "", stderr: "", code: 0 };
      ctx.lastCode = branch.code;
      return concatRes({ stdout: cond.stdout, stderr: cond.stderr, code: 0 }, branch);
    }
    case "For": {
      let words = [];
      for(const w of (node.wordlist || [])) words = words.concat(await expandWordToFields(w, ctx));
      let acc = { stdout: "", stderr: "", code: 0 };
      for(let i = 0; i < words.length; i++) {
        ctx.vars[node.name.text] = words[i];
        try {
          const r = await evalNode(node.do, ctx, null);
          ctx.lastCode = r.code;
          acc = concatRes(acc, r);
        } catch(e) {
          if(e instanceof BreakSig) { if(e.n > 1) { e.n--; throw e; } break; }
          if(e instanceof ContinueSig) { if(e.n > 1) { e.n--; throw e; } continue; }
          throw e;
        }
      }
      return acc;
    }
    case "While":
    case "Until": {
      let acc = { stdout: "", stderr: "", code: 0 }, iter = 0;
      for(;;) {
        if(++iter > MAX_LOOP)
          return concatRes(acc, { stdout: "", stderr: "loop aborted: 超過 " + MAX_LOOP + " 次迭代", code: 1 });
        const cond = await evalNode(node.clause, ctx, null);
        ctx.lastCode = cond.code;
        const go = node.type === "While" ? cond.code === 0 : cond.code !== 0;
        if(!go) break;
        try {
          const r = await evalNode(node.do, ctx, null);
          ctx.lastCode = r.code;
          acc = concatRes(acc, r);
        } catch(e) {
          if(e instanceof BreakSig) { if(e.n > 1) { e.n--; throw e; } break; }
          if(e instanceof ContinueSig) { if(e.n > 1) { e.n--; throw e; } continue; }
          throw e;
        }
      }
      return acc;
    }
    case "Case": {
      const subject = await expandString(node.clause, ctx);
      for(let i = 0; i < (node.cases || []).length; i++) {
        const item = node.cases[i];
        let hit = false;
        for(const p of (item.pattern || [])) {
          if(globToRegExp(await expandString(p, ctx)).test(subject)) { hit = true; break; }
        }
        if(hit) {
          if(!item.body) return { stdout: "", stderr: "", code: 0 };
          const r = await evalNode(item.body, ctx, null);
          ctx.lastCode = r.code;
          return r;
        }
      }
      return { stdout: "", stderr: "", code: 0 };
    }
    case "Function":
      ctx.funcs[node.name.text] = node.body;
      return { stdout: "", stderr: "", code: 0 };
    case "Subshell": {
      // vars 複本隔離; funcs/commands/positional 共用 reference (subshell 看得到,
      // 但 subshell 內定義的 function 也會外漏 — 與 bash 不同, 先接受)
      const sub = {
        vars: Object.assign({}, ctx.vars),
        funcs: ctx.funcs,
        commands: ctx.commands,
        positional: ctx.positional,
        scopes: [],
        lastCode: ctx.lastCode,
        esh: ctx.esh
      };
      return evalNode(node.list, sub, stdin);
    }
    default:
      return { stdout: "", stderr: node.type + ": 尚未支援 (層 3+)", code: 2 };
  }
}

// bash-parser 的巢狀 compound (for 裡的 if 等) 在同一行以 ; 或空格接續會
// parse 失敗, 換行則正常。shell 文法中換行與 ; 等價, 故 parse 前正規化:
// 1. 引號外的單一 ; (保留 case 的 ;;) → 換行
// 2. do/then/else/{ 後面直接接 if/for/while/until/case 時, 中間補換行
function normalizeSemicolons(src) {
  const LEAD = { "do": 1, "then": 1, "else": 1, "{": 1 };
  const START = { "if": 1, "for": 1, "while": 1, "until": 1, "case": 1 };
  const toks = [], seps = [];
  let cur = "", sep = "", inS = false, inD = false, esc = false;
  const flush = () => { if(cur !== "") { toks.push(cur); seps.push(sep); cur = ""; sep = ""; } };
  for(let i = 0; i < src.length; i++) {
    const c = src.charAt(i);
    if(esc) { cur += c; esc = false; continue; }
    if(c === "\\") { cur += c; esc = true; continue; }
    if(c === "'" && !inD) inS = !inS;
    else if(c === "\"" && !inS) inD = !inD;
    if(!inS && !inD) {
      if(c === ";") {
        if(src.charAt(i + 1) === ";") { cur += ";;"; i++; continue; }
        flush();
        sep = "\n";
        continue;
      }
      if(c === " " || c === "\t" || c === "\n") {
        flush();
        if(c === "\n" || sep === "") sep = (sep === "\n" || c === "\n") ? "\n" : c;
        continue;
      }
    }
    cur += c;
  }
  flush();
  let out = "";
  toks.forEach((t, i) => {
    if(i === 0) { out = t; return; }
    let s = seps[i] || " ";
    if(LEAD[toks[i - 1]] && START[t]) s = "\n";
    out += s + t;
  });
  return out;
}

// heredoc: bash-parser 會把 body 整個丟掉, 故 parse 前自行抽出 —
// body 寫進 /tmp/.heredoc-N, `<<DELIM` 改寫為 `< 檔案`。
// 未加引號的 delimiter 依 bash 語意展開 $VAR/${VAR}; <<- 剝行首 tab。
let heredocN = 0;
const heredocExpand = new Set();
function extractHeredocs(src, ctx) {
  if(src.indexOf("<<") < 0) return src;
  const lines = src.split("\n");
  const out = [];
  for(let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/);
    if(!m) { out.push(line); continue; }
    const strip = m[1] === "-", quotedDelim = m[2] !== "", delim = m[3];
    const body = [];
    let j = i + 1;
    for(; j < lines.length; j++) {
      const l = strip ? lines[j].replace(/^\t+/, "") : lines[j];
      if(l === delim) break;
      body.push(l);
    }
    const content = body.length ? body.join("\n") + "\n" : "";
    try { fs.mkdirSync("/tmp", { recursive: true }); } catch(e) { /* 已存在 */ }
    const path = "/tmp/.heredoc-" + (++heredocN);
    fs.writeFileSync(path, content);
    // 變數展開延後到讀取時 (同一行 NAME=w; cat <<EOF 的賦值才來得及生效)
    if(!quotedDelim) heredocExpand.add(path);
    out.push(line.replace(m[0], "< " + path));
    i = j;
  }
  return out.join("\n");
}

// 0.1.0 起為 async: 回傳 Promise<{stdout, stderr, code}>
// (自訂指令因此可為 async — 見「自訂指令」節)
export async function run(cmdline, ctx) {
  let ast;
  try { ast = parse(normalizeSemicolons(extractHeredocs(cmdline, ctx)), { mode: "posix" }); }
  catch(e) { return { stdout: "", stderr: "parse error: " + e.message, code: 2 }; }
  try { return await evalNode(ast, ctx, null); }
  catch(e) { return { stdout: "", stderr: "interp error: " + e.message, code: 1 }; }
}
