// redirect 寫入驗證迴歸 (Node): 模擬「寫入靜默失真」的 fs, 驗證 shell 會出聲
// 背景見 context/project/tasks/opfs-sync-write-loss.md
import { createShell } from "../src/node-entry.js";
import realFs from "fs";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if(cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (detail ? " — " + detail : "")); }
};

const d = realpathSync(mkdtempSync(join(tmpdir(), "esh-wv-")));

console.log("[A] 正常 fs: redirect 行為不變");
{
  const sh = await createShell();
  await sh.run("cd " + d);
  const r = await sh.run("echo hi > a.txt; cat a.txt");
  ok("> 寫入 + 讀回", r.stdout === "hi\n" && r.code === 0, JSON.stringify(r));
  const ap = await sh.run("echo more >> a.txt; cat a.txt");
  ok(">> append", ap.stdout === "hi\nmore\n", JSON.stringify(ap.stdout));
  const devnull = await sh.run("echo discard > /dev/null; echo ok");
  ok("> /dev/null 靜默丟棄", devnull.stdout === "ok\n" && devnull.code === 0, JSON.stringify(devnull));
  const enoent = await sh.run("echo x > /no-such-dir-xyz/f.txt");
  ok("寫到不存在目錄 → 報錯非靜默", enoent.code === 1 && enoent.stderr.indexOf("redirect:") >= 0, JSON.stringify(enoent));
}

console.log("[B] 說謊的 fs (寫入靜默失真): redirect 出聲");
{
  // 對 LOSSY 路徑: promises.writeFile 假裝成功但寫入空內容 — 模擬 OPFS 失真
  const LOSSY = (p) => String(p).indexOf("lossy.txt") >= 0;
  const lyingFs = new Proxy(realFs, {
    get(t, k) {
      if(k !== "promises") return t[k];
      return new Proxy(t.promises, {
        get(tp, kp) {
          if(kp !== "writeFile") return tp[kp];
          return (p, data, opts) => tp.writeFile(p, LOSSY(p) ? "" : data, opts);
        }
      });
    }
  });
  const sh = await createShell({ fs: lyingFs });
  await sh.run("cd " + d);
  const r = await sh.run("echo NEW > lossy.txt");
  ok("失真寫入 → code 1", r.code === 1, JSON.stringify(r));
  ok("stderr 有寫入驗證訊息", r.stderr.indexOf("redirect:") >= 0 && r.stderr.indexOf("驗證失敗") >= 0, JSON.stringify(r.stderr));
  const good = await sh.run("echo fine > normal.txt; cat normal.txt");
  ok("正常路徑不受影響", good.stdout === "fine\n" && good.code === 0, JSON.stringify(good));
}

console.log("");
console.log("[write-verify] " + pass + " passed, " + fail + " failed");
if(fail) process.exit(1);
