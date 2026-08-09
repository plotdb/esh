// 取代 vite-plugin-node-polyfills/shims/process:
// 補上 cwd/chdir/versions 等 shelljs + fast-glob 會用到的欄位
let cwd = "/home/web";
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
    cwd = "/" + parts.join("/");
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
globalThis.process = process;
export default process;
