// shell 直譯器跑在 Web Worker: 主執行緒只管 UI
// 0.2.0 起以 serveShell 掛標準協定(exec 線上格式不變, 新增 fs op 與 hello 握手)
// 協定: in {id, type:'exec', cmdline} → out {id, type:'result', stdout, stderr, code, cwd}
import "./process-fix.js";
import shell from "shelljs";
import fs from "fs";
import { hardenAsyncMounts } from "fs"; // zenfs Async mixin 修補 (fs-zen-shim)
import parse from "bash-parser";
import fg from "fast-glob";
import { configure } from "@zenfs/core";
import { WebAccess } from "@zenfs/dom";
import { esh } from "./base.js";
import { serveShell } from "./remote.js";
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
await hardenAsyncMounts();

// 首次使用才 seed(持久化資料不可清)
if(!fs.existsSync("/home/web/README.md")) seed();
shell.cd("/home/web");

const sh = esh({ fs, shell, parse, fg });
serveShell(sh, self, { persist });

// 初始 ready 廣播沿用(既有 client 靠這個顯示 banner);
// 晚 attach 的 client 走 connectShell 的 hello 握手, 不依賴這則
self.postMessage({ type: "ready", cwd: sh.cwd(), persist });
