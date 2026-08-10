// serveShell / connectShell 迴歸測試 (Node, 零瀏覽器): npm test
// 以 loopback 假 target 模擬 dedicated worker 語意:
// postMessage 廣播給對側所有 listener、structuredClone 過濾不可序列化 payload。
// 瀏覽器實機(真 Worker + OPFS)由 web/static/bundle-test.html 蓋。
import { createShell, serveShell, connectShell } from "../src/node-entry.js";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if(cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (detail ? " — " + detail : "")); }
};

// 假 target 對: [serverSide, clientSide]; 皆為 {postMessage, add/removeEventListener}
function makePair() {
  const mk = () => ({
    listeners: [],
    addEventListener(t, f) { if(t === "message") this.listeners.push(f); },
    removeEventListener(t, f) { this.listeners = this.listeners.filter((x) => x !== f); }
  });
  const a = mk(), b = mk();
  const deliver = (side, m) => {
    const data = structuredClone(m); // 模擬 structured clone(function 等直接丟)
    queueMicrotask(() => side.listeners.slice().forEach((f) => f({ data })));
  };
  a.postMessage = (m) => deliver(b, m);
  b.postMessage = (m) => deliver(a, m);
  return [a, b];
}

// realpath: macOS 的 tmpdir 是 symlink (/var → /private/var), pwd 回解析後路徑
const d = realpathSync(mkdtempSync(join(tmpdir(), "esh-remote-")));
const local = await createShell();
await local.run("cd " + d);

console.log("[A] 握手 — serveShell 晚掛 (hello 重試)");
{
  const [server, client] = makePair();
  setTimeout(() => serveShell(local, server, { persist: "test-fs" }), 350); // 錯過首輪 hello
  const sh = await connectShell(client);
  ok("晚掛 350ms 仍握手成功", !!sh, "");
  ok("ready 帶 serveShell info", sh.ready.persist === "test-fs", JSON.stringify(sh.ready));
  ok("cwd 就緒", sh.cwd === d, sh.cwd);

  console.log("[B] exec 經協定");
  const r = await sh.run("echo hi remote");
  ok("run 回 {stdout, code}", r.stdout === "hi remote\n" && r.code === 0, JSON.stringify(r));
  await sh.run("mkdir -p sub && cd sub");
  ok("cwd 隨 exec 更新", sh.cwd === d + "/sub", sh.cwd);
  await sh.run("cd " + d);

  console.log("[C] io — 內容不經 parser");
  const tricky = "line with 'quotes' \"and\" $VAR `backtick` \\ heredoc<<EOF\nEOF\n";
  await sh.io.writeFile(d + "/deep/dir/tricky.txt", tricky); // 自動建父目錄
  ok("writeFile 自動建父目錄 + 原文寫入", await sh.io.readFile(d + "/deep/dir/tricky.txt") === tricky, "");
  const bin = new Uint8Array([0, 255, 128, 10, 0, 7]);
  await sh.io.writeFile(d + "/bin.dat", bin);
  const back = await sh.io.readFile(d + "/bin.dat", null);
  ok("binary roundtrip (Uint8Array)", back instanceof Uint8Array && back.length === 6 && back[1] === 255, JSON.stringify([...back]));
  const err = await sh.io.readFile(d + "/no-such-file").then(() => null, (e) => e);
  ok("readFile 缺檔 → reject", err instanceof Error, String(err));

  console.log("[D] 多 client 同一 worker — 廣播過濾 + id 不撞號");
  const sh2 = await connectShell(client);
  const [ra, rb] = await Promise.all([sh.run("echo from-1"), sh2.run("echo from-2")]);
  ok("client1 拿到自己的結果", ra.stdout === "from-1\n", JSON.stringify(ra.stdout));
  ok("client2 拿到自己的結果", rb.stdout === "from-2\n", JSON.stringify(rb.stdout));

  console.log("[E] 與使用方協定並存");
  let customSeen = null;
  server.addEventListener("message", (ev) => { if(ev.data.type === "chat") customSeen = ev.data.text; });
  client.postMessage({ type: "chat", text: "hello agent" });
  await new Promise((r) => setTimeout(r, 10));
  ok("使用方自己的 type 不被 serveShell 干擾", customSeen === "hello agent", String(customSeen));
  const r2 = await sh.run("echo still-works");
  ok("並存後 exec 照常", r2.stdout === "still-works\n", "");

  console.log("[F] exec + fs 同一條 queue 序列化");
  const order = [];
  local.registerCommand("mark", async (argv) => {
    await new Promise((r) => setTimeout(r, 20));
    order.push(argv[0]);
    return "";
  });
  await Promise.all([
    sh.run("mark one"),
    sh.io.writeFile(d + "/q.txt", "q").then(() => order.push("fs")),
    sh.run("mark two")
  ]);
  ok("順序 = 送出順序", order.join(",") === "one,fs,two", order.join(","));
}

console.log("[G] 本地 sh.io 與 remote 同簽名 (drop-in)");
{
  await local.io.writeFile(d + "/local/x.txt", "local-io");
  ok("local writeFile 自動建父目錄", await local.io.readFile(d + "/local/x.txt") === "local-io", "");
  const bin = await local.io.readFile(d + "/bin.dat", null);
  ok("local binary 讀取", bin instanceof Uint8Array && bin.length === 6, "");
  ok("local cwd()", typeof local.cwd() === "string" && local.cwd().length > 0, "");
}

console.log("[H] dispose");
{
  const [server, client] = makePair();
  const srv = serveShell(local, server);
  const sh = await connectShell(client);
  srv.dispose();
  const timeout = await Promise.race([
    sh.run("echo x").then(() => "answered"),
    new Promise((r) => setTimeout(() => r("silent"), 100))
  ]);
  ok("dispose 後不再回應", timeout === "silent", timeout);
}

console.log("");
console.log("[remote] " + pass + " passed, " + fail + " failed");
if(fail) process.exit(1);
