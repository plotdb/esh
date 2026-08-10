// alias target for 'execa' — no child_process in browser; shell.exec() is out of scope
function unsupported() {
  throw new Error("shell.exec() is not supported in the browser (no child_process)");
}
export default unsupported;
export const sync = unsupported;
export const command = unsupported;
export const commandSync = unsupported;
