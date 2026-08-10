// git command pack 迴歸測試 (Node, 零瀏覽器): npm test
// 真 fs + tmpdir;OPFS/symlink 實機驗證另行於瀏覽器(見 git-support/plan.md)
import { createShell } from "../src/node-entry.js";
import { gitCommands, installGit } from "../src/git-command.js";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if(cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (detail ? " — " + detail : "")); }
};

const d = realpathSync(mkdtempSync(join(tmpdir(), "esh-git-")));
const sh = await createShell();
installGit(sh);
await sh.run("cd " + d);

console.log("[A] init / 無 repo 報錯");
{
  const noRepo = await sh.run("git status");
  ok("repo 外 status → 128", noRepo.code === 128, JSON.stringify(noRepo));
  const r = await sh.run("git init");
  ok("init", r.code === 0 && r.stdout.indexOf("Initialized") === 0, JSON.stringify(r));
}

console.log("[B] config / commit author 流程");
{
  const noAuthor = await sh.run("echo hi > a.txt; git add a.txt; git commit -m first");
  ok("無 config commit → 明確報錯", noAuthor.code === 1 && noAuthor.stderr.indexOf("user.name") >= 0, JSON.stringify(noAuthor));
  await sh.run("git config user.name tester; git config user.email t@example.com");
  const name = await sh.run("git config user.name");
  ok("config 讀回", name.stdout === "tester\n", JSON.stringify(name.stdout));
  const r = await sh.run("git commit -m first");
  ok("config 後 commit 成功", r.code === 0 && /^\[\w+ [0-9a-f]{7}\] first/.test(r.stdout), JSON.stringify(r));
}

console.log("[C] status");
{
  const clean = await sh.run("git status");
  ok("clean tree", clean.stdout.indexOf("working tree clean") >= 0, JSON.stringify(clean.stdout));
  await sh.run("echo more >> a.txt; echo new > b.txt");
  const dirty = await sh.run("git status");
  ok("modified 未 stage → ' M'", dirty.stdout.indexOf(" M a.txt") >= 0, JSON.stringify(dirty.stdout));
  ok("untracked → '??'", dirty.stdout.indexOf("?? b.txt") >= 0, JSON.stringify(dirty.stdout));
}

console.log("[D] add . / 刪除 stage / 子目錄相對路徑");
{
  await sh.run("mkdir -p sub; echo s > sub/c.txt; rm b.txt");
  await sh.run("git add .");
  const r = await sh.run("git status");
  ok("add . 收乾淨 (b.txt 未曾 commit, 無殘留)", r.stdout.indexOf("b.txt") < 0, JSON.stringify(r.stdout));
  ok("sub/c.txt staged", r.stdout.indexOf("A  sub/c.txt") >= 0, JSON.stringify(r.stdout));
  await sh.run("git commit -m second");
  await sh.run("cd sub; echo s2 >> c.txt");
  const r2 = await sh.run("git add c.txt; git status");
  ok("子目錄下相對路徑 add (findRoot)", r2.stdout.indexOf("M  sub/c.txt") >= 0, JSON.stringify(r2.stdout));
  await sh.run("git commit -m third; cd " + d);
  const del = await sh.run("rm a.txt; git add a.txt; git status");
  ok("刪除檔 add → 'D '", del.stdout.indexOf("D  a.txt") >= 0, JSON.stringify(del.stdout));
  await sh.run("git commit -m fourth");
}

console.log("[E] log");
{
  const r = await sh.run("git log --oneline");
  const lines = r.stdout.trim().split("\n");
  ok("--oneline 4 筆新在前", lines.length === 4 && lines[0].indexOf("fourth") > 0 && lines[3].indexOf("first") > 0, JSON.stringify(lines));
  const full = await sh.run("git log -n 1");
  ok("完整格式含 Author", full.stdout.indexOf("Author: tester <t@example.com>") >= 0, JSON.stringify(full.stdout));
}

console.log("[F] branch / checkout");
{
  await sh.run("git branch feature");
  const b = await sh.run("git branch");
  ok("branch 清單含 * 現行", /\* (master|main)/.test(b.stdout) && b.stdout.indexOf("  feature") >= 0, JSON.stringify(b.stdout));
  await sh.run("git checkout feature; echo feat > f.txt; git add f.txt; git commit -m feat");
  const onFeat = await sh.run("cat f.txt");
  ok("feature 上有 f.txt", onFeat.stdout === "feat\n", JSON.stringify(onFeat.stdout));
  const back = await sh.run("git checkout master 2>/dev/null || git checkout main");
  const gone = await sh.run("test -f f.txt; echo $?");
  ok("checkout 回主幹 f.txt 消失", gone.stdout.trim() !== "0", JSON.stringify({ back: back.stderr, gone: gone.stdout }));
  const st = await sh.run("git status");
  ok("切換後 working tree clean", st.stdout.indexOf("working tree clean") >= 0, JSON.stringify(st.stdout));
  const oid = (await sh.run("git log --oneline -n 1")).stdout.split(" ")[0];
  const det = await sh.run("git checkout " + oid);
  ok("oid checkout → 明確不支援訊息", det.code === 1 && det.stderr.indexOf("detached") >= 0, JSON.stringify(det));
}

console.log("[G] gitCommands() 經 createShell({commands}) (ctx.esh 路徑)");
{
  const sh2 = await createShell({ commands: gitCommands({ author: { name: "opt", email: "o@x" } }) });
  await sh2.run("cd " + d);
  const r = await sh2.run("git log --oneline -n 1");
  ok("另一 shell 建構時掛 git 可讀同 repo", r.code === 0 && r.stdout.length > 0, JSON.stringify(r));
}

console.log("");
console.log("[git] " + pass + " passed, " + fail + " failed");
if(fail) process.exit(1);
