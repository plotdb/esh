// vite 測試頁腳本 (/web/vitedev/terminal.html) — 與 bundle 共用 term.js,
// worker 以 vite 的靜態分析形式自建後傳入
import { createTerminal } from "./term.js";

createTerminal(document.getElementById("term"), {
  worker: new Worker(new URL("./shell.worker.js", import.meta.url), { type: "module" })
});
