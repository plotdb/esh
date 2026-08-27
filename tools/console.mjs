// esh 互動 console (npm run console) — dist/esh-node.js (node-zenfs) 沙箱
// 預設 InMemory + 種子檔案; 可掛真磁碟與 chroot 展示 0.5.0:
//   npm run console                                  # 純沙箱
//   npm run console -- --mount /home=./some/dir      # passthrough 掛真磁碟
//   npm run console -- --mount /home=./d --root /home  # + chroot (穿不出去)
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));
if(!existsSync(r("../dist/esh-node.js"))) {
  console.error("dist/esh-node.js 不存在 — 先 npm run build");
  process.exit(1);
}
const { createShell } = await import(r("../dist/esh-node.js"));

// --mount <virtual>=<realdir> (可多個, passthrough) / --root <path>
const argv = process.argv.slice(2);
const mounts = {};
let root = null;
for(let i = 0; i < argv.length; i++) {
  if(argv[i] === "--mount") {
    const [vpath, rdir] = String(argv[++i] || "").split("=");
    if(!vpath || !rdir) { console.error("用法: --mount /virtual=/real/dir"); process.exit(1); }
    mounts[vpath] = { backend: "passthrough", path: resolve(rdir) };
  }
  else if(argv[i] === "--root") root = argv[++i];
  else { console.error("未知參數: " + argv[i] + " (支援 --mount /v=/real --root /path)"); process.exit(1); }
}

const sandbox = !Object.keys(mounts).length;
const sh = await createShell(Object.assign(
  sandbox ? {} : { mounts },
  root ? { root } : {}
));
if(sandbox) {
  // 種子檔案 (與 web demo 對齊), 開場就有東西可玩
  await sh.io.writeFile("/home/web/README.md", "# esh sandbox\nfind the needle here\n");
  await sh.io.writeFile("/home/web/nums.txt", "10\n2\n33\n4\n");
  await sh.io.writeFile("/home/web/src/a.js", 'console.log("needle");\n');
  await sh.run("cd /home/web");
}

console.log("esh " + (sandbox ? "(InMemory 沙箱)" : "(passthrough: " +
  Object.keys(mounts).map((k) => k + "=" + mounts[k].path).join(", ") + ")") +
  (root ? " root=" + root : "") + " — help 看指令, exit 離開");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = () => { rl.setPrompt("esh:" + sh.cwd() + "$ "); rl.prompt(); };
// 行處理串進 queue — pipe 進來時 close 會先到, 需等佇列排空才退出
let queue = Promise.resolve();
let closed = false;
rl.on("line", (line) => {
  queue = queue.then(async () => {
    const cmd = line.trim();
    if(cmd === "exit" || cmd === "quit") { rl.close(); return; }
    if(cmd) {
      try {
        const res = await sh.run(cmd);
        if(res.stdout) process.stdout.write(res.stdout.replace(/\n?$/, "\n"));
        if(res.stderr) process.stderr.write(res.stderr.replace(/\n?$/, "\n"));
        if(res.code) process.stderr.write("[exit " + res.code + "]\n");
      } catch(e) { console.error("internal: " + e.message); }
    }
    if(!closed) prompt();
  });
});
rl.on("close", () => { closed = true; queue.then(() => { console.log(""); process.exit(0); }); });
prompt();
