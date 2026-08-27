// @plotdb/esh node-zenfs 宿主 entry (0.5.0, 見 tasks/node-entry-zenfs.md) —
// Node 走 zenfs: mounts / root(chroot) / device 與瀏覽器 bundle 行為一致。
// 由 tools/build.mjs 以 platform:node 打包 (fs alias → fs-zen-shim,
// 沿用瀏覽器那組已驗證的機制); 原零墊片 node-entry ('.') 原樣不動。
// backend 短名字表對齊 bundle-entry.js, 差異: opfs/indexeddb → passthrough
// (真磁碟子目錄掛進虛擬 fs)。全 backend 皆同步 — WebAccess 那三個
// async 鏡像 bug (replay echo / 不截斷 / redirect race) 在此結構上不存在。
import fs from "fs";
import { hardenAsyncMounts, makeFsScope, withFsScope, drainFsReplays } from "fs"; // fs-zen-shim
import shell from "shelljs";
import parse from "bash-parser";
import fg from "fast-glob";
import { configure, InMemory, Passthrough, PassthroughFS } from "@zenfs/core";
import { esh as eshBase } from "./base.js";
import { EshDevice } from "./device-fs.js";
import { guardFs } from "./fs-guard.js";
export { registerCommand } from "./core.js"; // 全域註冊 (跨 shell, 慎用)
export { serveShell, connectShell } from "./remote.js"; // 跨執行緒協定 (0.2.0)

shell.config.silent = true;

// 上游 bug (zenfs 2.6.2): PassthroughFS.touch/touchSync 把 undefined 的
// metadata.mode 直接餵 chmod — 真 node fs 會 throw, 寫既有檔案時
// close→sync→touch 整條炸掉, zenfs 還會卡進 stale 狀態。
// 補法: 只在值是數字時才 chmod/chown (timestamps 本來就由底層 fs 更新)
PassthroughFS.prototype.touchSync = function(path, md) {
  const p = this.path(path);
  if(md && typeof md.mode === "number") this.nodeFS.chmodSync(p, md.mode);
  if(md && typeof md.uid === "number" && typeof md.gid === "number") {
    try { this.nodeFS.chownSync(p, md.uid, md.gid); } catch(e) { /* 非 root 常態失敗 */ }
  }
};
PassthroughFS.prototype.touch = async function(path, md) {
  const p = this.path(path);
  if(md && typeof md.mode === "number") await this.nodeFS.promises.chmod(p, md.mode);
  if(md && typeof md.uid === "number" && typeof md.gid === "number") {
    try { await this.nodeFS.promises.chown(p, md.uid, md.gid); } catch(e) { /* 同上 */ }
  }
};

// 真 fs: bundle 內 'fs' 已被 alias 成 zenfs shim, 真 fs 走 runtime 取用
// (bundler 攔不到)。需 node >= 20.16 (getBuiltinModule)。
const realFs = globalThis.process.getBuiltinModule("node:fs");

// createShell() → InMemory (沙箱, 不碰真磁碟 — 與瀏覽器 bundle 同)
// createShell({ mounts }) → 自訂掛載:
//   { "/home": { backend: "passthrough", path: "/srv/ws/u123" } }
//     真磁碟目錄掛進虛擬 fs (對應瀏覽器的 opfs)。預設帶 symlink 圍堵
//     (jail 內真 symlink 指外 → EACCES, 見 fs-guard.js);
//     followSymlinks: true 可關 (信任該樹時)
//   memory / device / 直接給 zenfs backend 設定 — 同 bundle-entry
// createShell({ root }) → rooted shell (chroot, 同瀏覽器 0.4.0 語意)
// createShell({ commands }) → 掛一批自訂指令 (per-shell)
export function createShell(opts) {
  let p;
  try { p = (opts && opts.mounts) ? mountAll(opts.mounts) : Promise.resolve(); }
  catch(e) { p = Promise.reject(e); } // mount 設定錯誤一律走 rejection, 不同步 throw
  return p.then(() => eshBase({
    fs, shell, parse, fg,
    fsDrain: drainFsReplays,
    commands: opts && opts.commands,
    root: opts && opts.root,
    scopeHooks: { make: makeFsScope, with: withFsScope }
  }));
}

function mountAll(mounts) {
  const spec = {};
  Object.keys(mounts).forEach((k) => {
    const m = mounts[k];
    if(m.backend === "passthrough") {
      if(!m.path) throw new Error("esh: passthrough mount 需要 path (真磁碟目錄)");
      const jfs = m.followSymlinks ? realFs : guardFs(realFs, m.path);
      spec[k] = { backend: Passthrough, fs: jfs, prefix: m.path };
    }
    else if(m.backend === "memory") spec[k] = { backend: InMemory };
    else if(m.backend === "device") spec[k] = { backend: EshDevice, files: m.files };
    else if(m.backend === "opfs" || m.backend === "indexeddb")
      throw new Error("esh: backend '" + m.backend + "' 是瀏覽器限定 — Node 側對應為 passthrough");
    else spec[k] = m; // 進階: 直接給 zenfs backend 設定
  });
  return configure({ mounts: spec }).then(() => hardenAsyncMounts());
}

export const esh = eshBase;
export { fs };
