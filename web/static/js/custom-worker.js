// 自訂 esh worker 示範 — consumer 端 registerCommand + git pack
// 協定由 serveShell 代管 (exec / fs / hello 握手);
// ask 的 hostcall 是自訂訊息型別, 與 serveShell 並存互不干擾。
importScripts("/assets/esh/esh.iife.js");
importScripts("/assets/esh/esh-git.iife.js");

// ask: await 一個 postMessage 往返, 主執行緒以 <dialog> 要數字
let hostcallN = 0;
const pendingHost = {};
self.addEventListener("message", (ev) => {
  const m = ev.data;
  if(m.type !== "hostcall-result") return;
  const cb = pendingHost[m.id];
  if(cb) { delete pendingHost[m.id]; cb(m); }
});
const ask = (argv) => new Promise((resolve) => {
  const id = ++hostcallN;
  pendingHost[id] = (m) => resolve(
    m.cancelled ? { stdout: "", stderr: "ask: cancelled", code: 1 } : String(m.value) + "\n"
  );
  postMessage({ type: "hostcall", call: "ask-number", id, msg: argv.join(" ") });
});

(async () => {
  const commands = Object.assign({ ask }, eshGit.gitCommands());
  let sh, persist = "opfs";
  try {
    sh = await esh.createShell({ mounts: { "/home": { backend: "opfs" } }, commands });
  } catch(e) {
    persist = "in-memory (OPFS 掛載失敗: " + e.message + ")";
    sh = await esh.createShell({ commands });
  }
  await sh.run("mkdir -p /home/web; cd /home/web");
  esh.serveShell(sh, self, { persist });
  self.postMessage({ type: "ready", cwd: sh.cwd(), persist });
})();
