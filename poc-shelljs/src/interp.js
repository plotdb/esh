// M2.5 — shell 語法直譯層 (層 1-2)
// parser: bash-parser (posix mode) / evaluator: 本檔 / 指令本體: shelljs (M2 驗證)
import parse from "bash-parser";
import shell from "shelljs";
import { fs } from "memfs";
import fg from "fast-glob";

// ---------- context ----------
export function createContext() {
  return {
    vars: { HOME: "/home/web", PATH: "/bin" },
    lastCode: 0
  };
}

// ---------- word expansion ----------
// 把 word 拆成 segments: {text, quoted, expansion}
// 追蹤雙引號區域 (單引號 parser 已剝除), expansion 於此解析成值
function wordSegments(word, ctx) {
  const src = word.text;
  const exps = (word.expansion || []).slice().sort((a, b) => a.loc.start - b.loc.start);
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

  exps.forEach((e) => {
    literal(src.slice(pos, e.loc.start));
    let v = "";
    if(e.type === "ParameterExpansion") {
      if(e.parameter === "?") v = String(ctx.lastCode);
      else v = ctx.vars[e.parameter] !== undefined ? String(ctx.vars[e.parameter]) : "";
    } else if(e.type === "CommandExpansion") {
      const r = evalNode(e.commandAST, ctx, null);
      v = (r.stdout || "").replace(/\n+$/, "");
    }
    segments.push({ text: v, quoted: inDouble, expansion: true });
    pos = e.loc.end + 1;
  });
  literal(src.slice(pos));
  return segments;
}

// 單一字串 (redirect 目標、賦值右側): 不 field split、不 glob
function expandString(word, ctx) {
  const segs = wordSegments(word, ctx);
  let t = segs.map((s) => s.text).join("");
  if(word.text.charAt(0) === "~" && (t === "~" || t.slice(0, 2) === "~/"))
    t = ctx.vars.HOME + t.slice(1);
  return t;
}

// argv 用: 未加引號的 expansion 結果做 field splitting, 之後逐欄 glob
function expandWordToFields(word, ctx) {
  const segs = wordSegments(word, ctx);
  const fields = [];
  let cur = null;
  const ensure = () => { if(!cur) cur = { pattern: "", hasGlob: false }; };
  const flush = () => { if(cur) { fields.push(cur); cur = null; } };
  const addPiece = (text, quoted) => {
    ensure();
    cur.pattern += text;
    if(!quoted && /[*?[]/.test(text)) cur.hasGlob = true;
  };

  segs.forEach((seg) => {
    if(seg.expansion && !seg.quoted) {
      const parts = seg.text.split(/[ \t\n]+/);
      parts.forEach((p, i) => {
        if(i > 0) flush();
        if(p === "") { if(i === 0) flush(); return; }
        addPiece(p, false);
      });
    } else if(seg.quoted) {
      ensure();
      cur.pattern += seg.text;
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
    return { stdout: String(o.stdout), stderr: o.stderr ? String(o.stderr) : "", code: o.code || 0 };
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
  "true": () => ({ stdout: "", stderr: "", code: 0 }),
  "false": () => ({ stdout: "", stderr: "", code: 1 }),
  ":": () => ({ stdout: "", stderr: "", code: 0 }),
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

function callBuiltin(name, argv, stdin, ctx) {
  const fn = builtins[name];
  if(!fn) return { stdout: "", stderr: name + ": command not found", code: 127 };
  try { return fn(argv, stdin, ctx); }
  catch(e) { return { stdout: "", stderr: name + ": " + e.message, code: 1 }; }
}

builtins.xargs = (args, stdin, ctx) => {
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
  batches.forEach((batch) => {
    let argv;
    if(placeholder) argv = base.map((a) => a.split(placeholder).join(batch[0]));
    else argv = base.concat(batch);
    const r = callBuiltin(cmd, argv, null, ctx);
    if(r.stdout) out += r.stdout + (r.stdout.charAt(r.stdout.length - 1) === "\n" ? "" : "\n");
    if(r.stderr) errs.push(r.stderr);
    if(r.code > worst) worst = r.code;
  });
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
  else if(args.length === 1) ok = args[0].length > 0;
  return { stdout: "", stderr: "", code: ok ? 0 : 1 };
}

// ---------- evaluator ----------
function applyAssignments(list, ctx) {
  list.forEach((a) => {
    const s = expandString(a, ctx);
    const i = s.indexOf("=");
    ctx.vars[s.slice(0, i)] = s.slice(i + 1);
  });
}

function evalCommand(node, ctx, stdin) {
  const assignments = [], redirects = [];
  (node.prefix || []).concat(node.suffix || []).forEach((x) => {
    if(x.type === "Redirect") redirects.push(x);
    else if(x.type === "AssignmentWord") assignments.push(x);
  });
  if(!node.name) {
    applyAssignments(assignments, ctx);
    return { stdout: "", stderr: "", code: 0 };
  }
  // 暫時性賦值 (VAR=x cmd)
  const saved = {};
  assignments.forEach((a) => {
    const s = expandString(a, ctx);
    const i = s.indexOf("=");
    const k = s.slice(0, i);
    saved[k] = ctx.vars[k];
    ctx.vars[k] = s.slice(i + 1);
  });

  let argv = expandWordToFields(node.name, ctx);
  (node.suffix || []).forEach((x) => {
    if(x.type === "Word") argv = argv.concat(expandWordToFields(x, ctx));
  });

  let input = stdin;
  redirects.forEach((r) => {
    if(r.op.text === "<") {
      try { input = String(fs.readFileSync(expandString(r.file, ctx))); }
      catch(e) { input = ""; }
    }
  });

  let res = callBuiltin(argv[0], argv.slice(1), input, ctx);

  redirects.forEach((r) => {
    const target = expandString(r.file, ctx);
    const isErr = r.numberIo && r.numberIo.text === "2";
    const content = isErr ? res.stderr : res.stdout;
    if(r.op.text === ">") { shell.ShellString(content).to(target); }
    else if(r.op.text === ">>") { shell.ShellString(content).toEnd(target); }
    else return;
    if(isErr) res.stderr = ""; else res.stdout = "";
  });

  Object.keys(saved).forEach((k) => {
    if(saved[k] === undefined) delete ctx.vars[k];
    else ctx.vars[k] = saved[k];
  });
  return res;
}

function concatRes(a, b) {
  let out = a.stdout;
  if(out && out.charAt(out.length - 1) !== "\n" && b.stdout) out += "\n";
  return { stdout: out + b.stdout, stderr: [a.stderr, b.stderr].filter(Boolean).join("\n"), code: b.code };
}

function evalNode(node, ctx, stdin) {
  switch(node.type) {
    case "Script":
    case "CompoundList": {
      let acc = { stdout: "", stderr: "", code: 0 };
      (node.commands || []).forEach((c) => {
        const r = evalNode(c, ctx, null);
        ctx.lastCode = r.code;
        acc = concatRes(acc, r);
      });
      return acc;
    }
    case "LogicalExpression": {
      const left = evalNode(node.left, ctx, null);
      ctx.lastCode = left.code;
      const runRight = node.op === "and" ? left.code === 0 : left.code !== 0;
      if(!runRight) return left;
      const right = evalNode(node.right, ctx, null);
      ctx.lastCode = right.code;
      return concatRes(left, right);
    }
    case "Pipeline": {
      let cur = stdin, res = { stdout: "", stderr: "", code: 0 }, errs = [];
      node.commands.forEach((c) => {
        res = evalNode(c, ctx, cur);
        if(res.stderr) errs.push(res.stderr);
        cur = res.stdout;
      });
      ctx.lastCode = res.code;
      return { stdout: res.stdout, stderr: errs.join("\n"), code: res.code };
    }
    case "Command":
      return evalCommand(node, ctx, stdin);
    case "Subshell": {
      const sub = { vars: Object.assign({}, ctx.vars), lastCode: ctx.lastCode };
      return evalNode(node.list, sub, stdin);
    }
    default:
      return { stdout: "", stderr: node.type + ": 尚未支援 (層 3+)", code: 2 };
  }
}

export function run(cmdline, ctx) {
  let ast;
  try { ast = parse(cmdline, { mode: "posix" }); }
  catch(e) { return { stdout: "", stderr: "parse error: " + e.message, code: 2 }; }
  try { return evalNode(ast, ctx, null); }
  catch(e) { return { stdout: "", stderr: "interp error: " + e.message, code: 1 }; }
}
