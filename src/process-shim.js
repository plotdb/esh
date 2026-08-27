// 取代 vite-plugin-node-polyfills/shims/process:
// 補上 cwd/chdir/versions 等 shelljs + fast-glob 會用到的欄位
let cwd = "/home/web";
// scoped root (withFsScope) 用的 raw 存取 — 不觸發驗證與 zenfs pwd 同步
globalThis.__eshGetCwd = () => cwd;
globalThis.__eshSetCwd = (v) => { cwd = v; };
const listeners = {};
const process = {
  platform: "linux",
  arch: "wasm",
  version: "v18.0.0",
  versions: { node: "18.0.0" },
  env: { HOME: "/home/web", PATH: "/usr/local/bin:/usr/bin:/bin" },
  argv: ["node", "browser"],
  pid: 1,
  browser: true,
  cwd: function() { return cwd; },
  chdir: function(dir) {
    // node 的 chdir 接受相對路徑; 這裡對現有 cwd 解析並正規化 . / ..
    const abs = dir.charAt(0) === "/" ? dir : cwd + "/" + dir;
    const parts = [];
    abs.split("/").forEach(function(seg) {
      if(seg === "" || seg === ".") return;
      if(seg === "..") parts.pop();
      else parts.push(seg);
    });
    const target = "/" + parts.join("/");
    // node 的 chdir 對不存在/非目錄丟 ENOENT/ENOTDIR (shelljs cd 靠這個
    // 判錯); 驗證需要 fs, 由 fs shim 掛 hook 提供
    if(globalThis.__eshValidateCwd) globalThis.__eshValidateCwd(target);
    cwd = target;
    if(globalThis.__syncFsCwd) globalThis.__syncFsCwd(cwd);
  },
  umask: function() { return 0o22; },
  hrtime: function(prev) {
    const now = performance.now();
    const sec = Math.floor(now / 1000), nsec = Math.round((now % 1000) * 1e6);
    if(prev) return [sec - prev[0], nsec - prev[1]];
    return [sec, nsec];
  },
  nextTick: function(fn) {
    const args = Array.prototype.slice.call(arguments, 1);
    queueMicrotask(function() { fn.apply(null, args); });
  },
  on: function(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return process; },
  off: function() { return process; },
  once: function(ev, fn) { return process.on(ev, fn); },
  removeListener: function() { return process; },
  emit: function() { return false; },
  listeners: function(ev) { return listeners[ev] || []; },
  stdout: { write: function(s) { console.log(s); return true; }, isTTY: false },
  stderr: { write: function(s) { console.error(s); return true; }, isTTY: false },
  exit: function(code) { console.warn("[process-shim] exit(" + code + ") ignored"); },
  exitCode: 0
};
// 瀏覽器無 process global → 補上; node-zenfs bundle 下真 process 已存在,
// 不得覆蓋 (宿主 app 共用同一 process global) — bundle 內部經 esbuild inject
// 拿到的本來就是這個 shim, 不依賴 global
if(typeof globalThis.process === "undefined") globalThis.process = process;
export default process;
