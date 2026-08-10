// @plotdb/esh bundle 層 — 依賴於打包時(esbuild alias)解掉,
// 產出 self-contained ESM: 使用者零設定 import
import fs from "fs";
import shell from "shelljs";
import parse from "bash-parser";
import fg from "fast-glob";
import { configure, InMemory } from "@zenfs/core";
import { WebAccess, IndexedDB } from "@zenfs/dom";
import { esh as eshBase } from "./base.js";
export { registerCommand } from "./core.js"; // 全域註冊 (跨 shell, 慎用)
export { serveShell, connectShell } from "./remote.js"; // 跨執行緒協定 (0.2.0)

shell.config.silent = true;

// 一般用法: createShell() → 直接可用 (InMemory)
// createShell({ mounts }) → 自訂掛載, 如 OPFS 持久化:
//   { "/home": { backend: "opfs" } }
// createShell({ commands }) → 掛一批自訂指令 (per-shell);
//   簽名 (argv, stdin, ctx) → {stdout, stderr, code} | string
//   之後也可用 sh.registerCommand(name, fn) / ({name: fn, ...}) 增掛
export function createShell(opts) {
  const p = (opts && opts.mounts) ? mountAll(opts.mounts) : Promise.resolve();
  return p.then(() => eshBase({ fs, shell, parse, fg, commands: opts && opts.commands }));
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
    spec[k] = m; // 進階: 直接給 zenfs backend 設定
  }), Promise.resolve()).then(() => configure({ mounts: spec }));
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
