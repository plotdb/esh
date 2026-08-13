// @plotdb/esh bundle 層 — 依賴於打包時(esbuild alias)解掉,
// 產出 self-contained ESM: 使用者零設定 import
import fs from "fs";
import { hardenAsyncMounts, makeFsScope, withFsScope } from "fs"; // fs-zen-shim
import shell from "shelljs";
import parse from "bash-parser";
import fg from "fast-glob";
import { configure, InMemory } from "@zenfs/core";
import { WebAccess, IndexedDB } from "@zenfs/dom";
import { esh as eshBase } from "./base.js";
import { EshDevice } from "./device-fs.js";
export { registerCommand } from "./core.js"; // 全域註冊 (跨 shell, 慎用)
export { serveShell, connectShell } from "./remote.js"; // 跨執行緒協定 (0.2.0)

shell.config.silent = true;

// 一般用法: createShell() → 直接可用 (InMemory)
// createShell({ mounts }) → 自訂掛載, 如 OPFS 持久化:
//   { "/home": { backend: "opfs" } }
//   device backend (0.4.0): { "/dev": { backend: "device", files: {
//     sheet: { read: () => csv, write: (s) => apply(s) } } } }  // write 省略 = 唯讀
// createShell({ commands }) → 掛一批自訂指令 (per-shell)
// createShell({ root: "/home/ws/blocks/foo" }) → rooted shell (0.4.0):
//   shell 指令與 io 都被關在 root 內("/" 即 root), cd .. / 絕對路徑 /
//   glob 都穿不出去;sh.chroot(p) 可重定向 (host 端 JS API, shell 內呼叫不到)
export function createShell(opts) {
  const p = (opts && opts.mounts) ? mountAll(opts.mounts) : Promise.resolve();
  return p.then(() => eshBase({
    fs, shell, parse, fg,
    commands: opts && opts.commands,
    root: opts && opts.root,
    scopeHooks: { make: makeFsScope, with: withFsScope }
  }));
}

function mountAll(mounts) {
  const spec = {};
  const keys = Object.keys(mounts);
  return keys.reduce((p, k) => p.then(() => {
    const m = mounts[k];
    if(m.backend === "opfs")
      return navigator.storage.getDirectory().then((handle) => {
        spec[k] = { backend: WebAccess, handle };
      });
    if(m.backend === "indexeddb") { spec[k] = { backend: IndexedDB }; return; }
    if(m.backend === "memory") { spec[k] = { backend: InMemory }; return; }
    if(m.backend === "device") { spec[k] = { backend: EshDevice, files: m.files }; return; }
    spec[k] = m; // 進階: 直接給 zenfs backend 設定
  }), Promise.resolve()).then(() => configure({ mounts: spec })).then(() => hardenAsyncMounts());
}

export const esh = eshBase;
export { fs };

eshBase.pkg = {
  name: "@plotdb/esh",
  dependencies: [
    { name: "shelljs", version: "0.10.0" },
    { name: "bash-parser", version: "0.5.0" },
    { name: "fast-glob", version: "3.x" },
    { name: "@zenfs/core", version: "2.6.2" },
    { name: "@zenfs/dom", version: "1.x" }
  ]
};