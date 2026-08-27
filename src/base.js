// @plotdb/esh base 層 — factory: 依賴由使用者以 ctx 注入
// (概念同 @plotdb/rescope 的 load-to-context)
// 不變量: ctx.fs 與 ctx.shell 內部綁定的 fs 必須是同一個實作 —
// shelljs 的 fs 在其打包當下已定案, base 無從代換, 僅能驗證。
import { initDeps, createContext, run, commandMap } from "./core.js";

export function esh(ctx) {
  ["fs", "shell", "parse", "fg"].forEach((k) => {
    if(!ctx[k]) throw new Error("esh: ctx 缺少依賴 '" + k + "'");
  });
  initDeps(ctx);

  // sanity check: fs 與 shelljs 需同一世界 (見上方不變量)
  try {
    ctx.fs.mkdirSync("/tmp", { recursive: true });
    ctx.fs.writeFileSync("/tmp/.esh-check", "1");
    if(!ctx.shell.test("-f", "/tmp/.esh-check"))
      throw new Error("esh: ctx.fs 與 ctx.shell 綁定的 fs 不是同一個實作");
    ctx.fs.unlinkSync("/tmp/.esh-check");
  } catch(e) {
    if(String(e.message).indexOf("esh:") === 0) throw e;
    // fs 尚未可寫(如 mount 未完成)不視為致命, 由使用者自行負責
  }

  const state = createContext();
  // 自訂指令: per-shell registry (ctx.commands 可於建構時給一批)
  if(ctx.commands) Object.assign(state.commands, commandMap(ctx.commands));
  // 自訂指令經 ctx.esh 碰檔案 (git 等 command pack 依賴此介面, 0.3.0)
  // rooted shell (0.4.0): scope = {root, pwd, procCwd, fs(bound)};
  // shelljs 系 builtin 由 core 以 withScope 括住, 其餘一律走 scope.fs
  const applyRoot = (root) => {
    if(!ctx.scopeHooks) throw new Error("esh: 此宿主不支援 root/chroot (需 zenfs scope hooks — 瀏覽器 bundle 限定)");
    const scope = ctx.scopeHooks.make(root);
    state.esh = {
      fs: scope.fs,
      cwd: () => scope.procCwd,
      scope,
      withScope: (fn) => ctx.scopeHooks.with(scope, fn)
    };
  };
  if(ctx.root) applyRoot(ctx.root);
  else state.esh = { fs: ctx.fs, cwd: () => String(ctx.shell.pwd()) };
  // run 為 async(0.1.0);同一 shell 的 run 以 promise chain 序列化,
  // 避免並發 run 交錯互踩共享狀態(vars/cwd/lastCode/positional)。
  // 回傳各次呼叫自己的結果(非 chain 尾), 錯誤不斷鏈。
  let queue = Promise.resolve();
  const api = {
    run: (cmdline) => {
      const p = queue.then(() => run(cmdline, state));
      queue = p.catch(() => {});
      return p;
    },
    registerCommand: (name, fn) => {
      Object.assign(state.commands, commandMap(name, fn));
      return api; // 可鏈式呼叫
    },
    // io: promise 版內容傳輸子集, 與 connectShell 的 io 同簽名 —
    // local/remote shell 對消費端 drop-in(0.2.0)。任意內容不經 shell
    // parser, 一律走這裡;fs(node-style, sync/callback)仍在供進階使用。
    // readFile: encoding 預設 'utf8' 回 string;null/'binary' 回 Uint8Array
    // writeFile: content 收 string | Uint8Array;自動建父目錄
    io: {
      readFile: async (path, encoding) => {
        if(encoding === undefined) encoding = "utf8";
        if(encoding === null || encoding === "binary") {
          // new Uint8Array(typedArray) 是複製 — 斷開 Buffer pool 底層,
          // structured clone 才不會拖整個 pool 的 ArrayBuffer 過去
          return new Uint8Array(state.esh.fs.readFileSync(path));
        }
        return String(state.esh.fs.readFileSync(path, encoding));
      },
      writeFile: async (path, content) => {
        const dir = path.slice(0, path.lastIndexOf("/"));
        if(dir) state.esh.fs.mkdirSync(dir, { recursive: true });
        state.esh.fs.writeFileSync(path, content);
      },
      // readdir/stat (0.5.0, wagent file-tree 需求): 回純 JSON 形狀 —
      // 跨 postMessage 不能帶 Dirent/Stats 物件, local/remote 才能 drop-in
      readdir: async (path, opts) => {
        const names = state.esh.fs.readdirSync(path).map(String);
        if(!(opts && opts.withFileTypes)) return names;
        const base = path === "/" ? "" : path.replace(/\/+$/, "");
        return names.map((name) => {
          let isDirectory = false;
          try { isDirectory = state.esh.fs.statSync(base + "/" + name).isDirectory(); }
          catch(e) { /* 壞 entry (如被擋的 symlink) → 當一般檔 */ }
          return { name, isDirectory };
        });
      },
      stat: async (path) => {
        const s = state.esh.fs.statSync(path);
        return { size: s.size, mtimeMs: s.mtimeMs, isFile: s.isFile(), isDirectory: s.isDirectory() };
      }
    },
    cwd: () => state.esh.cwd(),
    // chroot: 重新定 root (host 端 API — shell 指令無法呼叫到, agent 穿不出去)
    chroot: (root) => { applyRoot(root); return api; },
    context: state,
    createContext,
    fs: ctx.fs
  };
  return api;
}
