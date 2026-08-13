// alias target for 'fs' — ZenFS 版 (branch dev/zenfs)
// ZenFS 相對路徑用自己的 context cwd, 不理 process.cwd() —
// 掛 hook 讓 process-shim 的 chdir 同步過來
import { fs, defaultContext, mounts, bindContext } from "@zenfs/core";
export * from "@zenfs/core";

// --- scoped root (chroot) 支援(0.4.0, 見 tasks/scoped-root-and-device-backend.md)---
// per-shell root: shell 執行 shelljs/fast-glob 這類「綁全域 fs」的同步指令時,
// 以 withFsScope 暫時把 zenfs defaultContext 的 root/pwd(與 process-shim cwd)
// 換成該 shell 的 scope — 同步區間內單執行緒, 不會與其他 shell 交錯;
// core 自己的非同步寫入與自訂指令則用 bindContext 的 bound fs(context 隨呼叫走)。
// zenfs 的路徑解析先對「使用者可見 root(/)」正規化再 join(ctx.root),
// `..` 在 / 就被夾住, 絕對路徑一律 re-root — 這是圍堵的核心保證。
export function makeFsScope(root) {
  fs.mkdirSync(root, { recursive: true });
  const bound = bindContext({ root, pwd: "/" });
  return { root, pwd: "/", procCwd: "/", fs: bound.fs };
}
export function withFsScope(scope, fn) {
  if(!scope) return fn();
  const saved = {
    root: defaultContext.root, pwd: defaultContext.pwd,
    proc: globalThis.__eshGetCwd ? globalThis.__eshGetCwd() : null
  };
  defaultContext.root = scope.root;
  defaultContext.pwd = scope.pwd;
  if(globalThis.__eshSetCwd) globalThis.__eshSetCwd(scope.procCwd);
  try { return fn(); }
  finally {
    // 捕捉 cd 效果回 scope, 再還原全域
    scope.pwd = defaultContext.pwd;
    if(globalThis.__eshGetCwd) scope.procCwd = globalThis.__eshGetCwd();
    defaultContext.root = saved.root;
    defaultContext.pwd = saved.pwd;
    if(saved.proc !== null && globalThis.__eshSetCwd) globalThis.__eshSetCwd(saved.proc);
  }
}

// --- zenfs Async mixin 修補(資料遺失, 見 tasks/opfs-sync-write-loss.md)---
// async backend (OPFS/WebAccess) 的 sync 寫入 = 寫入記憶體鏡像 + 排 async replay。
// zenfs 以「stack 字串比對」(isInLoop) 判斷 async 呼叫是否為 replay — bundle 後
// stack 格式不符, 每個 replay 都被誤判為新呼叫而把參數 echo 回鏡像:
// pre-truncate 的 {size: 0} 一 echo, 鏡像 stat size 歸零 → readFileSync 依
// stat size 配 buffer 讀到空字串 → sed -i 這類 read-modify-write 把檔案清空,
// 且一切 exit code 0。此處把偵測換成明確的 reentrancy flag, 行為與 zenfs
// 原意一致(replay 不 echo、直接的 async 呼叫照樣同步進鏡像)。
// 需在 configure() 完成後呼叫(bundle-entry mountAll / shell.worker)。
// 回傳 promise: 等所有 mount 的 ready()(鏡像 preload 完成)— 關掉
// 「掛載後初始化期間寫入, sync 讀不到」的窗口(zenfs 於 preload 期間跳過鏡像更新)。
export function hardenAsyncMounts() {
  const readies = [];
  for(const [, inst] of mounts) {
    if(inst && typeof inst.ready === "function") readies.push(inst.ready());
  }
  for(const [, inst] of mounts) {
    if(!inst || !inst._sync || typeof inst._async !== "function" || inst.__eshHardened) continue;
    inst.__eshHardened = true;
    const origAsync = inst._async.bind(inst);
    inst._async = (thunk) => origAsync(async () => {
      inst.__eshInReplay = true;
      try { return await thunk(); }
      finally { inst.__eshInReplay = false; }
    });
    const proto = Object.getPrototypeOf(inst);
    // WebAccess 的 write 用 createWritable({keepExistingData}) 從 offset 覆寫,
    // 從不截斷 — 覆寫較短內容時舊尾巴留在 OPFS 上, 鏡像蓋住看不見, 重載才爆
    // (tasks/opfs-overwrite-no-truncate.md)。touch 帶 size 時是唯一知道
    // 「檔案邏輯長度」的時機: 若真檔比 size 長, 補一刀 truncate。
    const truncateReal = async (path, size) => {
      if(typeof inst.get !== "function") return; // 僅 WebAccess 形狀的 backend
      const handle = await inst.get("file", path).catch(() => null);
      if(!handle || handle.kind !== "file") return;
      const f = await handle.getFile();
      if(f.size <= size) return;
      const w = await handle.createWritable({ keepExistingData: true });
      await w.truncate(size);
      await w.close();
    };
    ["rename", "touch", "createFile", "unlink", "rmdir", "mkdir", "link", "write"].forEach((key) => {
      const original = proto[key]; // 類別上未被 _patchAsync 蓋掉的原始方法
      if(typeof original !== "function") return;
      inst[key] = async (...args) => {
        const result = await original.apply(inst, args);
        if(key === "touch" && args[1] && typeof args[1].size === "number")
          await truncateReal(args[0], args[1].size).catch(() => {});
        if(inst.__eshInReplay || !inst._isInitialized) return result;
        // 直接的 async 呼叫(如 fs.promises.writeFile)照 zenfs 原意同步進鏡像
        try { inst._sync[key + "Sync"] && inst._sync[key + "Sync"](...args); }
        catch(e) { /* 鏡像 echo 失敗不影響主寫入 */ }
        return result;
      };
    });
  }
  return Promise.all(readies).then(() => {});
}
globalThis.__syncFsCwd = (dir) => { defaultContext.pwd = dir; };
// process-shim 的 chdir 用這個驗證目標 (模擬 node chdir 的 ENOENT/ENOTDIR)
globalThis.__eshValidateCwd = (dir) => {
  const st = fs.statSync(dir); // 不存在 → zenfs 丟 ENOENT
  if(!st.isDirectory()) {
    const e = new Error("ENOTDIR: not a directory, chdir '" + dir + "'");
    e.code = "ENOTDIR";
    throw e;
  }
};
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

// 4. 寫後驗證: async backend (OPFS) 的 sync 寫入曾發生「truncate 生效、內容
// 未寫入」的靜默失真 (見 tasks/opfs-sync-write-loss.md) — 寫完立刻以 statSync
// 驗 size (sync 鏡像層失真當下即可見), 不符丟 EIO, 讓 sed -i 等 shelljs 內部
// 寫入至少出聲 (shelljs 會轉成該指令的 stderr + code 1), 不再無聲清空檔案
const _writeFileSync = fs.writeFileSync.bind(fs);
function writeFileSyncVerified(path, data, options) {
  _writeFileSync(path, data, options);
  if(typeof path !== "string") return; // fd 形式不驗
  const enc = typeof options === "string" ? options : (options && options.encoding) || "utf8";
  let expect = null;
  if(typeof data === "string" && enc === "utf8") expect = new TextEncoder().encode(data).length;
  else if(data && data.byteLength !== undefined) expect = data.byteLength;
  if(expect === null) return; // 其他 encoding 不驗
  const st = fs.statSync(path);
  if((st.mode & 0xF000) === 0x2000) return; // char device (device backend) — 寫入可能有損, 不驗
  const size = st.size;
  if(size !== expect) {
    const e = new Error("EIO: 寫入未落地 (寫後 size " + size + " != 預期 " + expect + "): " + path);
    e.code = "EIO";
    throw e;
  }
}

// 瀏覽器 prebundle 的 fs 物件屬性是 getter-only, 不能就地覆寫 → 建複本
const fsCompat = Object.assign({}, fs, {
  readdirSync: readdirSyncSorted,
  symlinkSync: symlinkSyncCompat,
  chmodSync: chmodSyncCompat,
  writeFileSync: writeFileSyncVerified
});

// 明確 named export 蓋掉 export * 的同名版本
// (shelljs 走 default, fast-glob/@nodelib 可能走 named — 兩邊都要接到修補版)
export { readdirSyncSorted as readdirSync, symlinkSyncCompat as symlinkSync, chmodSyncCompat as chmodSync, writeFileSyncVerified as writeFileSync };
export default fsCompat;
