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
    context: state,
    createContext,
    fs: ctx.fs
  };
  return api;
}
