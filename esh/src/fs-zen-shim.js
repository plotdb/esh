// alias target for 'fs' — ZenFS 版 (branch dev/zenfs)
// ZenFS 相對路徑用自己的 context cwd, 不理 process.cwd() —
// 掛 hook 讓 process-shim 的 chdir 同步過來
import { fs, defaultContext } from "@zenfs/core";
export * from "@zenfs/core";
globalThis.__syncFsCwd = (dir) => { defaultContext.pwd = dir; };
defaultContext.pwd = "/home/web";

// --- ZenFS 與 Node fs 的行為差異修補 (M2 存活表驗出) ---

// 1. readdir 回插入順序 (memfs/常見系統為排序) → 排序
const _readdirSync = fs.readdirSync.bind(fs);
function readdirSyncSorted(path, options) {
  const r = _readdirSync(path, options);
  if(r.length && typeof r[0] === "string") return r.sort();
  return r.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// 2. symlinkSync 不接受 type=null (Node 接受; shelljs ln -s 會傳 null)
const _symlinkSync = fs.symlinkSync.bind(fs);
function symlinkSyncCompat(target, path, type) {
  return type ? _symlinkSync(target, path, type) : _symlinkSync(target, path);
}

// 3. 目錄 chmod 丟 EISDIR (POSIX 允許) → 目錄靜默跳過, 檔案照常
const _chmodSync = fs.chmodSync.bind(fs);
function chmodSyncCompat(path, mode) {
  try { return _chmodSync(path, mode); }
  catch(e) {
    if(e.code === "EISDIR") return;
    throw e;
  }
}

// 瀏覽器 prebundle 的 fs 物件屬性是 getter-only, 不能就地覆寫 → 建複本
const fsCompat = Object.assign({}, fs, {
  readdirSync: readdirSyncSorted,
  symlinkSync: symlinkSyncCompat,
  chmodSync: chmodSyncCompat
});

// 明確 named export 蓋掉 export * 的同名版本
// (shelljs 走 default, fast-glob/@nodelib 可能走 named — 兩邊都要接到修補版)
export { readdirSyncSorted as readdirSync, symlinkSyncCompat as symlinkSync, chmodSyncCompat as chmodSync };
export default fsCompat;
