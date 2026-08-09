// 取代 polyfill 的 os shim: homedir/tmpdir 要對應 memfs 的實際路徑
export function homedir() { return "/home/web"; }
export function tmpdir() { return "/tmp"; }
export function platform() { return "linux"; }
export function type() { return "Linux"; }
export function release() { return "6.0.0"; }
export function arch() { return "wasm"; }
export function hostname() { return "browser"; }
export function endianness() { return "LE"; }
export function cpus() { return [{ model: "wasm", speed: 1000, times: {} }]; }
export function totalmem() { return 1 << 30; }
export function freemem() { return 1 << 29; }
export function userInfo() { return { username: "web", homedir: "/home/web", shell: "/bin/jsh" }; }
export const EOL = "\n";
export default {
  homedir, tmpdir, platform, type, release, arch, hostname,
  endianness, cpus, totalmem, freemem, userInfo, EOL
};
