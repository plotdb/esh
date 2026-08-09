// shell 直譯器跑在 Web Worker: 主執行緒只管 UI
// 協定: in {id, type:'exec', cmdline} → out {id, type:'result', stdout, stderr, code, cwd}
import "./process-fix.js";
import { vol } from "memfs";
import shell from "shelljs";
import { createContext, run } from "./interp.js";

shell.config.silent = true;

vol.fromJSON({
  "/home/web/README.md": "# demo\nshell in browser\nfind the needle here\n",
  "/home/web/src/a.js": "const x = 1;\nconsole.log(\"needle\", x);\n",
  "/home/web/src/b.txt": "banana\napple\ncherry\napple\n",
  "/home/web/src/nested/c.txt": "deep needle\n",
  "/home/web/nums.txt": "10\n2\n33\n4\n",
  "/tmp/.keep": ""
}, "/");
shell.cd("/home/web");

const ctx = createContext();

self.onmessage = (ev) => {
  const msg = ev.data;
  if(msg.type === "exec") {
    let r;
    try { r = run(msg.cmdline, ctx); }
    catch(e) { r = { stdout: "", stderr: "internal: " + e.message, code: 1 }; }
    self.postMessage({
      id: msg.id, type: "result",
      stdout: r.stdout || "", stderr: r.stderr || "", code: r.code || 0,
      cwd: String(shell.pwd())
    });
  }
};

self.postMessage({ type: "ready", cwd: String(shell.pwd()) });
