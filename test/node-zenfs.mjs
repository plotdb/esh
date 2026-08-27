// node-zenfs entry (0.5.0, tasks/node-entry-zenfs.md): npm run build 後 npm test
// 測 dist/esh-node.js — passthrough mounts / chroot 圍堵 / symlink guard / device
import { existsSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));
if(!existsSync(r("../dist/esh-node.js"))) {
  console.log("[node-zenfs] dist/esh-node.js 不存在, 跳過 (先 npm run build)");
  process.exit(0);
}
const { createShell } = await import(r("../dist/esh-node.js"));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if(cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (detail ? " — " + detail : "")); }
};

// jail: 專用真磁碟目錄 + 事先埋好的穿透 symlink
const jail = realpathSync(mkdtempSync(join(tmpdir(), "esh-jail-")));
const outside = realpathSync(mkdtempSync(join(tmpdir(), "esh-outside-")));
writeFileSync(join(outside, "secret.txt"), "SECRET-OUTSIDE");
writeFileSync(join(jail, "ok.txt"), "inside ok\n");
mkdirSync(join(jail, "ws"));
symlinkSync(join(outside, "secret.txt"), join(jail, "evil-abs"));
symlinkSync("../" + outside.split("/").pop() + "/secret.txt", join(jail, "evil-rel"));
symlinkSync(join(outside, "not-yet.txt"), join(jail, "broken-out"));

const deviceValue = { csv: "a,b\n1,2\n" };
const sh = await createShell({ mounts: {
  "/home": { backend: "passthrough", path: jail },
  "/home/dev": { backend: "device", files: { sheet: { read: () => deviceValue.csv } } },
  "/raw": { backend: "passthrough", path: jail, followSymlinks: true },
  "/mem": { backend: "memory" }
} });

console.log("[A] passthrough 雙向可見");
{
  const w = await sh.run("cd /home && echo from-shell > w.txt && cat w.txt");
  ok("shell 寫 → shell 讀", w.stdout === "from-shell\n", JSON.stringify(w));
  ok("shell 寫 → 真磁碟可見", readFileSync(join(jail, "w.txt"), "utf8") === "from-shell\n");
  writeFileSync(join(jail, "host.txt"), "from-host\n");
  const h = await sh.run("cat /home/host.txt");
  ok("真磁碟寫 → shell 可見", h.stdout === "from-host\n", JSON.stringify(h.stdout));
  const deep = await sh.run("cd /home && mkdir -p a/b/c && echo x > a/b/c/d.txt && cat a/b/c/d.txt && rm -rf a && ls a");
  ok("mkdir -p / rm -rf 正常 (guard 不誤傷)", deep.stdout.indexOf("x") === 0 && deep.code !== 0, JSON.stringify(deep));
  const ap = await sh.run("cd /home && echo x > ap.txt && echo y >> ap.txt && cat ap.txt");
  ok(">> append", ap.stdout === "x\ny\n", JSON.stringify(ap.stdout));
}

console.log("[B] symlink guard (預設開)");
{
  const abs = await sh.run("cat /home/evil-abs");
  ok("既有絕對 symlink 指外 → 拒", abs.code !== 0 && abs.stdout.indexOf("SECRET") < 0, JSON.stringify(abs));
  const rel = await sh.run("cat /home/evil-rel");
  ok("既有相對 symlink 指外 → 拒", rel.code !== 0 && rel.stdout.indexOf("SECRET") < 0, JSON.stringify(rel));
  const okf = await sh.run("cat /home/ok.txt");
  ok("jail 內一般檔不受影響", okf.stdout === "inside ok\n", JSON.stringify(okf));
  const bw = await sh.run("echo leak > /home/broken-out");
  const leaked = existsSync(join(outside, "not-yet.txt"));
  ok("斷 symlink 指外 → 寫入拒, 外部無檔", bw.code !== 0 && !leaked, JSON.stringify({ bw, leaked }));
  const mk = await sh.run("cd /home && ln -s /etc/hosts esc; cat esc");
  ok("shell 內 ln -s 指外 → 讀不到外部內容", mk.stdout.indexOf("127.0.0.1") < 0, JSON.stringify(mk.stdout.slice(0, 60)));
  const raw = await sh.run("cat /raw/evil-abs");
  ok("followSymlinks: true → 放行 (opt-out)", raw.stdout === "SECRET-OUTSIDE", JSON.stringify(raw));
}

console.log("[C] chroot 圍堵 (rooted shell, 同一份 fs)");
{
  const ag = await createShell({ root: "/home/ws" });
  await ag.run("echo agent-file > mine.txt");
  ok("rooted 寫入落在 root 內 (真磁碟)", readFileSync(join(jail, "ws/mine.txt"), "utf8") === "agent-file\n");
  const up = await ag.run("cd .. && pwd");
  ok("cd .. 夾在 /", up.stdout.trim() === "/", JSON.stringify(up.stdout));
  const abs = await ag.run("cat /../../etc/hosts");
  ok("/../../ 絕對路徑穿不出", abs.code !== 0 || abs.stdout.indexOf("localhost") < 0, JSON.stringify(abs.code));
  const par = await ag.run("cat ../ok.txt");
  ok("../ 讀不到 root 外 (jail 其他檔)", par.code !== 0, JSON.stringify(par));
  const glob = await ag.run("ls ../*");
  ok("glob ../* 不見 root 外", glob.stdout.indexOf("ok.txt") < 0, JSON.stringify(glob.stdout));
  const evil = await ag.run("cat /a/../../evil-abs");
  ok("組合路徑 + symlink 雙重穿透 → 拒", evil.code !== 0 && evil.stdout.indexOf("SECRET") < 0, JSON.stringify(evil));
  let ioEsc = null;
  try { ioEsc = await ag.io.readFile("/../ok.txt"); } catch(e) { ioEsc = "ERR"; }
  ok("io.readFile 穿不出 root", ioEsc === "ERR" || String(ioEsc).indexOf("inside ok") < 0, JSON.stringify(ioEsc));
}

console.log("[D] device backend");
{
  const d = await sh.run("cat /home/dev/sheet");
  ok("device 讀", d.stdout === "a,b\n1,2\n", JSON.stringify(d.stdout));
  deviceValue.csv = "a,b\n9,9\n";
  const d2 = await sh.run("cat /home/dev/sheet");
  ok("device live 值", d2.stdout === "a,b\n9,9\n", JSON.stringify(d2.stdout));
  const h = await sh.run("head /home/dev/sheet");
  ok("bare head 無 NUL (0.4.2 迴歸)", h.stdout === "a,b\n9,9\n", JSON.stringify(h.stdout.length));
  const w = await sh.run("echo x > /home/dev/sheet");
  ok("無 write callback → EROFS", w.code !== 0 && w.stderr.indexOf("EROFS") >= 0, JSON.stringify(w));
}

console.log("[E] memory mount + 邊角");
{
  const m = await sh.run("echo mem > /mem/m.txt && cat /mem/m.txt");
  ok("memory mount 可用", m.stdout === "mem\n", JSON.stringify(m.stdout));
  const raw = await sh.run("cd /home && echo raw > rw.txt && cat rw.txt");
  ok("redirect read-after-write (sync backend)", raw.stdout === "raw\n", JSON.stringify(raw.stdout));
  const noPath = await createShell({ mounts: { "/x": { backend: "passthrough" } } }).then(() => null, (e) => e);
  ok("passthrough 缺 path → 報錯", noPath && String(noPath.message).indexOf("path") >= 0, String(noPath && noPath.message));
  const opfs = await createShell({ mounts: { "/x": { backend: "opfs" } } }).then(() => null, (e) => e);
  ok("opfs 在 node → 明確報錯", opfs && String(opfs.message).indexOf("passthrough") >= 0, String(opfs && opfs.message));
}

console.log("");
console.log("[node-zenfs] " + pass + " passed, " + fail + " failed");
if(fail) process.exit(1);
