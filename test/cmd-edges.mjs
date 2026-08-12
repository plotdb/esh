// 指令邊角迴歸 (wagent 使用端回報, 見 0.3.2/0.3.3 CHANGELOG): npm test
import { createShell } from "../src/node-entry.js";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if(cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (detail ? " — " + detail : "")); }
};

const d = realpathSync(mkdtempSync(join(tmpdir(), "esh-edge-")));
const sh = await createShell();
await sh.run("cd " + d);

console.log("[A] sed 多重運算式 (; 串接)");
{
  const r = await sh.run("echo ac | sed 's/a/b/;s/c/d/'");
  ok("兩段都套用", r.stdout === "bd\n", JSON.stringify(r.stdout));
  await sh.run("echo ac > se.txt");
  await sh.run("sed -i 's/a/b/;s/c/d/' se.txt");
  const f = await sh.run("cat se.txt");
  ok("-i 多段", f.stdout === "bd\n", JSON.stringify(f.stdout));
  const file = await sh.run("echo xy > s2.txt; sed 's/x/1/;s/y/2/' s2.txt");
  ok("檔案非 -i 多段", file.stdout.indexOf("12") >= 0, JSON.stringify(file.stdout));
  const lit = await sh.run("echo 'a;c' | sed 's/;/-/'");
  ok("s/// 內的 ; 是字面值", lit.stdout === "a-c\n", JSON.stringify(lit.stdout));
  const bad = await sh.run("echo x | sed 's/a/b/;zzz'");
  ok("壞掉的後段 → 報錯非靜默", bad.code === 1 && bad.stderr.length > 0, JSON.stringify(bad));
}

console.log("[B] grep -c / -q / exit code 語意");
{
  await sh.run("echo a > g.txt; echo b >> g.txt; echo a >> g.txt");
  const c = await sh.run("grep -c a g.txt");
  ok("-c 計數", c.stdout === "2\n" && c.code === 0, JSON.stringify(c));
  const c0 = await sh.run("grep -c zzz g.txt");
  ok("-c 無符合 → 0 + code 1", c0.stdout === "0\n" && c0.code === 1, JSON.stringify(c0));
  const q = await sh.run("grep -q a g.txt; echo code:$?");
  ok("-q 有符合 → code 0", q.stdout === "code:0\n", JSON.stringify(q.stdout));
  const q1 = await sh.run("grep -q zzz g.txt; echo code:$?");
  ok("-q 無符合 → code 1", q1.stdout === "code:1\n", JSON.stringify(q1.stdout));
  const nomatch = await sh.run("echo a | grep zzz; echo code:$?");
  ok("無符合 exit 1 (POSIX)", nomatch.stdout === "code:1\n", JSON.stringify(nomatch.stdout));
  const badflag = await sh.run("echo a | grep -Z a");
  ok("不支援 flag → 出聲", badflag.code !== 0 && badflag.stderr.length > 0, JSON.stringify(badflag));
}

console.log("[C] redirect read-after-write (同一命令列)");
{
  const r = await sh.run("echo raw > rw.txt && cat rw.txt");
  ok("> 後同列讀取", r.stdout === "raw\n", JSON.stringify(r.stdout));
  const r2 = await sh.run("echo a > x.txt && echo b >> x.txt && cat x.txt | wc -l");
  ok(">> 後同列讀取", r2.stdout === "2\n", JSON.stringify(r2.stdout));
}

console.log("");
console.log("[cmd-edges] " + pass + " passed, " + fail + " failed");
if(fail) process.exit(1);
