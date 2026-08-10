// child_process stub — 瀏覽器無 process, shell.exec() 不支援
function unsupported() {
  throw new Error("child_process is not available in the browser");
}
export const spawn = unsupported;
export const exec = unsupported;
export const execSync = unsupported;
export const execFile = unsupported;
export const execFileSync = unsupported;
export const fork = unsupported;
export const spawnSync = unsupported;
export default { spawn, exec, execSync, execFile, execFileSync, fork, spawnSync };
