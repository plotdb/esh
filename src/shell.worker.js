// shell 直譯器跑在 Web Worker: 主執行緒只管 UI
// 協定: in {id, type:'exec', cmdline} → out {id, type:'result', stdout, stderr, code, cwd}
import "./process-fix.js";
import shell from "shelljs";
import fs from "fs";
import { configure } from "@zenfs/core";
import { WebAccess } from "@zenfs/dom";
import { createContext, run } from "./interp.js";
import { seed } from "./seed.js";

shell.config.silent = true;

// /home 掛 OPFS(持久化), /tmp 留預設 InMemory
let persist = "in-memory";
try {
  const handle = await navigator.storage.getDirectory();
  await configure({ mounts: { "/home": { backend: WebAccess, handle } } });
  persist = "opfs";
} catch(e) {
  persist = "in-memory (OPFS 掛載失敗: " + e.message + ")";
}

// 首次使用才 seed(持久化資料不可清)
if(!fs.existsSync("/home/web/README.md")) seed();
shell.cd("/home/web");

const ctx = createContext();

// run 為 async(0.1.0);以 promise chain 序列化, 確保多個 exec 不交錯共享狀態
let queue = Promise.resolve();
self.onmessage = (ev) => {
  const msg = ev.data;
  if(msg.type !== "exec") return;
  queue = queue.then(async () => {
    let r;
    try { r = await run(msg.cmdline, ctx); }
    catch(e) { r = { stdout: "", stderr: "internal: " + e.message, code: 1 }; }
    self.postMessage({
      id: msg.id, type: "result",
      stdout: r.stdout || "", stderr: r.stderr || "", code: r.code || 0,
      cwd: String(shell.pwd())
    });
  });
};

self.postMessage({ type: "ready", cwd: String(shell.pwd()), persist });
