import "./process-fix.js";
import fs from "fs";
import shell from "shelljs";
import { seed } from "./seed.js";

seed();

shell.config.silent = true;

const results = [];
function run(label, fn) {
  let out, ok = true;
  try {
    out = fn();
    if(out && out.stderr) ok = !out.code;
    out = (out && out.stdout !== undefined) ? out.stdout : String(out);
  } catch(e) {
    ok = false;
    out = "EXCEPTION: " + e.message;
  }
  results.push({ label, ok, out });
}

run("pwd", () => shell.pwd());
run("ls /home/web", () => shell.ls("/home/web").join("\n"));
run("ls -R (glob)", () => shell.ls("-R", "/home/web").join("\n"));
run("cat README.md", () => shell.cat("/home/web/README.md"));
run("cd + relative path", () => { shell.cd("/home/web/src"); return shell.cat("b.txt"); });
run("grep needle (single)", () => shell.grep("needle", "/home/web/README.md"));
run("grep -l needle (glob, 檔案)", () => shell.grep("-l", "needle", "/home/web/src/*.*"));
run("grep 目錄混入 glob (ShellJS 已知限制)", () => shell.grep("-l", "needle", "/home/web/src/*"));
run("sed /apple/→mango", () => shell.sed(/apple/, "mango", "/home/web/src/b.txt"));
run("sed -i (寫回)", () => { shell.sed("-i", /banana/, "kiwi", "/home/web/src/b.txt"); return shell.cat("/home/web/src/b.txt"); });
run("sort", () => shell.sort("/home/web/src/b.txt"));
run("head -n 1", () => shell.head({ "-n": 1 }, "/home/web/README.md"));
run("tail -n 1", () => shell.tail({ "-n": 1 }, "/home/web/README.md"));
run("wc via cat().length", () => String(shell.cat("/home/web/README.md").split("\n").length));
run("mkdir -p", () => { shell.mkdir("-p", "/tmp/x/y/z"); return String(shell.test("-d", "/tmp/x/y/z")); });
run("cp -r", () => { shell.cp("-r", "/home/web/src", "/tmp/copy"); return shell.ls("-R", "/tmp/copy").join("\n"); });
run("mv", () => { shell.mv("/tmp/copy/a.js", "/tmp/copy/a2.js"); return shell.ls("/tmp/copy").join("\n"); });
run("rm -rf", () => { shell.rm("-rf", "/tmp/copy"); return String(shell.test("-d", "/tmp/copy")); });
run("touch", () => { shell.touch("/tmp/new.txt"); return String(shell.test("-f", "/tmp/new.txt")); });
run("chmod 755", () => { shell.chmod(755, "/tmp/new.txt"); return (fs.statSync("/tmp/new.txt").mode & 0o777).toString(8); });
run("ln -s + readlink", () => { shell.ln("-s", "/home/web/README.md", "/tmp/link.md"); return shell.cat("/tmp/link.md"); });
run("echo > file (to())", () => { shell.echo("written from browser").to("/tmp/out.txt"); return shell.cat("/tmp/out.txt"); });
run("find", () => shell.find("/home/web").join("\n"));
run("uniq", () => { shell.ShellString("a\na\nb\n").to("/tmp/u.txt"); return shell.uniq("/tmp/u.txt"); });
run("exec (預期失敗)", () => shell.exec("ls"));

// render
const app = document.getElementById("app");
const summary = document.getElementById("summary");
let passed = 0;
results.forEach((r) => {
  if(r.ok) passed++;
  const div = document.createElement("div");
  div.className = "case";
  div.innerHTML = "<span class='" + (r.ok ? "pass'>✔" : "fail'>✘") + "</span> <span class='cmd'></span><pre class='out'></pre>";
  div.querySelector(".cmd").textContent = r.label;
  div.querySelector(".out").textContent = (r.out || "").trim().slice(0, 500);
  app.appendChild(div);
});
summary.textContent = passed + " / " + results.length + " passed (exec 失敗是預期行為)";
console.log("[poc] " + passed + "/" + results.length + " passed");
window.shell = shell;
window.fs = fs;
console.log("[poc] window.shell / window.fs ready — 可直接在 console 玩");
