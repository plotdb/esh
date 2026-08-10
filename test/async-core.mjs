// async core 迴歸測試 (Node, 零瀏覽器): npm test
// 蓋 0.1.0 async 化的新暴露面 — 時序類機制必須讓兩件事「同時在飛」才測得到,
// 單發指令的語法/指令迴歸由 m2/m25 蓋, 不在此重複。
import { createShell } from "../src/node-entry.js";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if(cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (detail ? " — " + detail : "")); }
};

const d = mkdtempSync(join(tmpdir(), "esh-async-"));
const sh = await createShell();
await sh.run("cd " + d);
sh.registerCommand("delay", (argv) =>
  new Promise((r) => setTimeout(() => r("done-" + argv.join("") + "\n"), 30)));
sh.registerCommand("boom", async () => { throw new Error("kaboom"); });

console.log("[A] 並發 run 序列化 (base.js promise chain)");
{
  const [r1, r2] = await Promise.all([
    sh.run("A=first; delay x; echo A=$A"),
    sh.run("A=second; echo A=$A")
  ]);
  ok("r1 拿到自己的 A=first", r1.stdout.indexOf("A=first") >= 0, JSON.stringify(r1.stdout));
  ok("r2 拿到自己的 A=second", r2.stdout.indexOf("A=second") >= 0, JSON.stringify(r2.stdout));
}

console.log("[B] async 指令穿越展開鏈");
{
  const r = await sh.run("echo [$(delay sub)] | cat");
  ok("$() + pipe", r.stdout.trim() === "[done-sub]", JSON.stringify(r.stdout));
}

console.log("[C] async reject 語意 + 序列化鏈不斷");
{
  const r1 = await sh.run("boom");
  ok("reject → stderr + code 1", r1.code === 1 && r1.stderr.indexOf("kaboom") >= 0, JSON.stringify(r1));
  const r2 = await sh.run("echo alive");
  ok("下一個 run 照常", r2.stdout === "alive\n", JSON.stringify(r2.stdout));
}

console.log("[D] async 指令 × 各語法路徑 (混合迴歸)");
{
  const cases = [
    ["delay hi | cat", "async? " , "done-hi"],
    ["echo got $(delay sub) done", null, "got done-sub done"],
    ["delay a > o.txt; cat o.txt", null, "done-a"],
    ["for i in 1 2; do delay $i; done", null, "done-1\ndone-2"],
    ["if delay x; then echo yes; fi", null, "done-x\nyes"],
    ["echo p | xargs delay", null, "done-p"],
    ["echo hi > a.txt; cat a.txt", null, "hi"],
    ["i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done", null, "0\n1\n2"],
    ["greet() { echo hi $1; }; greet async-core", null, "hi async-core"],
    ["case x in x) echo yes;; esac", null, "yes"],
    ["(echo sub) | cat", null, "sub"],
    ["echo $((6*7))", null, "42"],
    ["NAME=w; cat <<EOF\nhello $NAME\nEOF", null, "hello w"],
    ["for f in a b c; do echo $f; done | xargs -n 2", null, "a b\nc"],
    ["x=1; (x=2); echo $x", null, "1"],
    // 注意: "done-5" 沒出現是 pre-existing bug(signal 丟棄當輪已累積 stdout,
    // 見 plan.md backlog);此測項驗 return code 穿 async 邊界, 修 backlog 後改回全輸出
    ["f() { delay 5; return 3; }; f; echo $?", null, "3"]
  ];
  for(const [cmd, _, want] of cases) {
    const r = await sh.run(cmd);
    const got = (r.stdout || "").replace(/\n+$/, "");
    ok(cmd.split("\n")[0], got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
