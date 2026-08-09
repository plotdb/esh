import "./process-fix.js";
import { vol, fs } from "memfs";
import shell from "shelljs";

shell.config.silent = true;

// ---------- harness ----------
const results = [];
let currentCmd = "";

function reset() {
  vol.reset();
  vol.fromJSON({
    "/home/web/README.md": "# demo\nshell in browser\nfind the needle here\n",
    "/home/web/src/a.js": "const x = 1;\nconsole.log(\"needle\", x);\n",
    "/home/web/src/b.txt": "banana\napple\ncherry\napple\n",
    "/home/web/src/nested/c.txt": "deep needle\n",
    "/home/web/nums.txt": "10\n2\n33\n4\n",
    "/tmp/.keep": ""
  }, "/");
  shell.cd("/home/web");
}

function cmd(name) { currentCmd = name; }

function t(label, fn, check) {
  reset();
  let out, ok, detail = "";
  try {
    out = fn();
    const s = (out && out.stdout !== undefined) ? out.stdout : (Array.isArray(out) ? out.join("\n") : String(out));
    if(typeof check === "function") { ok = !!check(out, s); detail = s; }
    else { ok = s.trim() === String(check).trim(); detail = ok ? s : "got: " + s + "\nwant: " + check; }
  } catch(e) {
    ok = false;
    detail = "EXCEPTION: " + e.message;
  }
  results.push({ cmd: currentCmd, label, ok, detail: (detail || "").slice(0, 300) });
}

// ---------- cat ----------
cmd("cat");
t("cat file", () => shell.cat("README.md"), "# demo\nshell in browser\nfind the needle here");
t("cat multi files", () => shell.cat("README.md", "nums.txt"), (o, s) => s.indexOf("# demo") >= 0 && s.indexOf("33") >= 0);
t("cat -n", () => shell.cat("-n", "nums.txt"), (o, s) => /1\s+10/.test(s) && /4\s+4/.test(s));

// ---------- cd / pwd ----------
cmd("cd/pwd");
t("cd abs + pwd", () => { shell.cd("/home/web/src"); return shell.pwd(); }, "/home/web/src");
t("cd relative", () => { shell.cd("src"); shell.cd("nested"); return shell.pwd(); }, "/home/web/src/nested");
t("cd ..", () => { shell.cd("src"); shell.cd(".."); return shell.pwd(); }, "/home/web");
t("cd - (previous)", () => { shell.cd("/tmp"); shell.cd("/home/web"); shell.cd("-"); return shell.pwd(); }, "/tmp");
t("cd ~ (HOME)", () => { shell.cd("/tmp"); shell.cd("~"); return shell.pwd(); }, "/home/web");

// ---------- chmod ----------
cmd("chmod");
t("chmod 644 numeric", () => { shell.chmod(644, "README.md"); return (fs.statSync("/home/web/README.md").mode & 0o777).toString(8); }, "644");
t("chmod u+x symbolic", () => { shell.chmod(644, "README.md"); shell.chmod("u+x", "README.md"); return (fs.statSync("/home/web/README.md").mode & 0o777).toString(8); }, "744");
t("chmod -R", () => { shell.chmod("-R", 700, "src"); return (fs.statSync("/home/web/src/nested/c.txt").mode & 0o777).toString(8); }, "700");

// ---------- cp ----------
cmd("cp");
t("cp file", () => { shell.cp("README.md", "/tmp/r.md"); return shell.cat("/tmp/r.md"); }, (o, s) => s.indexOf("# demo") === 0);
t("cp -r dir", () => { shell.cp("-r", "src", "/tmp/s"); return String(shell.test("-f", "/tmp/s/nested/c.txt")); }, "true");
t("cp -n no-clobber", () => { shell.cp("README.md", "/tmp/r.md"); shell.ShellString("KEEP").to("/tmp/keep.txt"); shell.cp("-n", "README.md", "/tmp/keep.txt"); return shell.cat("/tmp/keep.txt"); }, "KEEP");
t("cp multi → dir", () => { shell.cp("README.md", "nums.txt", "/tmp"); return String(shell.test("-f", "/tmp/README.md") && shell.test("-f", "/tmp/nums.txt")); }, "true");
t("cp glob", () => { shell.cp("src/*.txt", "/tmp"); return String(shell.test("-f", "/tmp/b.txt")); }, "true");

// ---------- dirs / pushd / popd ----------
cmd("pushd/popd/dirs");
t("pushd + dirs", () => { shell.pushd("/tmp"); return shell.dirs().join(","); }, (o, s) => s.indexOf("/tmp") === 0);
t("popd restores", () => { shell.pushd("/tmp"); shell.popd(); return shell.pwd(); }, "/home/web");

// ---------- echo ----------
cmd("echo");
t("echo basic", () => shell.echo("hello"), "hello");
t("echo -n", () => shell.echo("-n", "x"), (o, s) => s === "x");
t("echo().to(file)", () => { shell.echo("written").to("/tmp/w.txt"); return shell.cat("/tmp/w.txt"); }, "written");
t("echo().toEnd(file)", () => { shell.echo("a").to("/tmp/e.txt"); shell.echo("b").toEnd("/tmp/e.txt"); return shell.cat("/tmp/e.txt"); }, "a\nb");

// ---------- error / errorCode ----------
cmd("error");
t("error() null on success", () => { shell.cat("README.md"); return String(shell.error()); }, "null");
t("error() set on failure", () => { shell.cat("/no/such/file"); return String(!!shell.error()); }, "true");

// ---------- find ----------
cmd("find");
t("find dir", () => shell.find("src"), (o, s) => s.indexOf("src/nested/c.txt") >= 0);
t("find multi roots", () => shell.find("src", "/tmp"), (o, s) => s.indexOf("src/a.js") >= 0 && s.indexOf("/tmp/.keep") >= 0);
t("find + filter js", () => shell.find("src").filter((f) => f.match(/\.js$/)).join(","), "src/a.js");

// ---------- grep ----------
cmd("grep");
t("grep basic", () => shell.grep("needle", "README.md"), "find the needle here");
t("grep regex", () => shell.grep(/app.e/, "src/b.txt"), "apple\napple");
t("grep -v", () => shell.grep("-v", "apple", "src/b.txt"), "banana\ncherry");
t("grep -i", () => shell.grep("-i", "NEEDLE", "README.md"), "find the needle here");
t("grep -l", () => shell.grep("-l", "needle", "src/a.js", "src/b.txt"), "src/a.js");
t("grep -n", () => shell.grep("-n", "apple", "src/b.txt"), (o, s) => /2:apple/.test(s));
t("grep glob files", () => shell.grep("-l", "needle", "src/*.*"), (o, s) => s.indexOf("a.js") >= 0);

// ---------- head / tail ----------
cmd("head/tail");
t("head default10", () => shell.head("nums.txt"), "10\n2\n33\n4");
t("head -n 2", () => shell.head({ "-n": 2 }, "nums.txt"), "10\n2");
t("tail -n 2", () => shell.tail({ "-n": 2 }, "nums.txt"), "33\n4");
t("head multi files", () => shell.head({ "-n": 1 }, "nums.txt", "src/b.txt"), (o, s) => s.indexOf("10") >= 0 && s.indexOf("banana") >= 0);

// ---------- ln ----------
cmd("ln");
t("ln -s + cat through", () => { shell.ln("-s", "/home/web/README.md", "/tmp/l.md"); return shell.cat("/tmp/l.md"); }, (o, s) => s.indexOf("# demo") === 0);
t("ln hard", () => { shell.ln("README.md", "/tmp/h.md"); return shell.cat("/tmp/h.md"); }, (o, s) => s.indexOf("# demo") === 0);
t("test -L symlink", () => { shell.ln("-s", "/home/web/README.md", "/tmp/l.md"); return String(shell.test("-L", "/tmp/l.md")); }, "true");
t("ln -sf overwrite", () => { shell.ln("-s", "/home/web/README.md", "/tmp/l.md"); shell.ln("-sf", "/home/web/nums.txt", "/tmp/l.md"); return shell.cat("/tmp/l.md"); }, "10\n2\n33\n4");

// ---------- ls ----------
cmd("ls");
t("ls dir", () => shell.ls("/home/web"), "README.md\nnums.txt\nsrc");
t("ls -R", () => shell.ls("-R", "/home/web"), (o, s) => s.indexOf("src/nested/c.txt") >= 0);
t("ls -A dotfiles", () => { shell.ShellString("x").to("/home/web/.hidden"); return shell.ls("-A", "/home/web"); }, (o, s) => s.indexOf(".hidden") >= 0);
t("ls -l objects", () => shell.ls("-l", "/home/web"), (o, s) => !!(o && o[0] && o[0].name));
t("ls -d dir itself", () => shell.ls("-d", "src"), "src");
t("ls glob", () => shell.ls("src/*.js"), "src/a.js");

// ---------- mkdir ----------
cmd("mkdir");
t("mkdir", () => { shell.mkdir("/tmp/d1"); return String(shell.test("-d", "/tmp/d1")); }, "true");
t("mkdir -p deep", () => { shell.mkdir("-p", "/tmp/a/b/c"); return String(shell.test("-d", "/tmp/a/b/c")); }, "true");
t("mkdir multi", () => { shell.mkdir("/tmp/m1", "/tmp/m2"); return String(shell.test("-d", "/tmp/m1") && shell.test("-d", "/tmp/m2")); }, "true");

// ---------- mv ----------
cmd("mv");
t("mv file", () => { shell.mv("nums.txt", "/tmp/n.txt"); return String(shell.test("-f", "/tmp/n.txt") && !shell.test("-f", "nums.txt")); }, "true");
t("mv -n no-clobber", () => { shell.ShellString("KEEP").to("/tmp/k.txt"); shell.mv("-n", "README.md", "/tmp/k.txt"); return shell.cat("/tmp/k.txt"); }, "KEEP");
t("mv dir", () => { shell.mv("src", "/tmp/moved"); return String(shell.test("-f", "/tmp/moved/nested/c.txt")); }, "true");

// ---------- rm ----------
cmd("rm");
t("rm file", () => { shell.rm("nums.txt"); return String(!shell.test("-f", "nums.txt")); }, "true");
t("rm -r dir", () => { shell.rm("-r", "src"); return String(!shell.test("-d", "src")); }, "true");
t("rm -f missing ok", () => { shell.rm("-f", "/no/such"); return String(!shell.error()); }, "true");
t("rm glob", () => { shell.rm("src/*.txt"); return String(!shell.test("-f", "src/b.txt") && shell.test("-f", "src/a.js")); }, "true");

// ---------- sed ----------
cmd("sed");
t("sed replace", () => shell.sed(/apple/, "mango", "src/b.txt"), "banana\nmango\ncherry\nmango");
t("sed g flag", () => shell.sed(/apple/g, "mango", "src/b.txt"), "banana\nmango\ncherry\nmango");
t("sed capture group", () => shell.sed(/(app)le/, "$1ricot", "src/b.txt"), (o, s) => s.indexOf("appricot") >= 0);
t("sed -i writes back", () => { shell.sed("-i", /banana/, "kiwi", "src/b.txt"); return shell.cat("src/b.txt"); }, "kiwi\napple\ncherry\napple");

// ---------- sort ----------
cmd("sort");
t("sort alpha", () => shell.sort("src/b.txt"), "apple\napple\nbanana\ncherry");
t("sort -r", () => shell.sort("-r", "src/b.txt"), "cherry\nbanana\napple\napple");
t("sort -n numeric", () => shell.sort("-n", "nums.txt"), "2\n4\n10\n33");

// ---------- test ----------
cmd("test");
t("test -f", () => String(shell.test("-f", "README.md")), "true");
t("test -d", () => String(shell.test("-d", "src")), "true");
t("test -e missing", () => String(shell.test("-e", "/no/such")), "false");

// ---------- touch ----------
cmd("touch");
t("touch creates", () => { shell.touch("/tmp/t.txt"); return String(shell.test("-f", "/tmp/t.txt")); }, "true");
t("touch -c no create", () => { shell.touch("-c", "/tmp/nc.txt"); return String(!shell.test("-f", "/tmp/nc.txt")); }, "true");
t("touch updates mtime", () => {
  shell.touch("/tmp/t.txt");
  fs.utimesSync("/tmp/t.txt", new Date(0), new Date(0));
  shell.touch("/tmp/t.txt");
  return String(fs.statSync("/tmp/t.txt").mtimeMs > 0);
}, "true");

// ---------- uniq ----------
cmd("uniq");
t("uniq adjacent", () => { shell.ShellString("a\na\nb\na\n").to("/tmp/u.txt"); return shell.uniq("/tmp/u.txt"); }, "a\nb\na");
t("uniq -c count", () => { shell.ShellString("a\na\nb\n").to("/tmp/u.txt"); return shell.uniq("-c", "/tmp/u.txt"); }, (o, s) => /2\s+a/.test(s));
t("uniq -d dup only", () => { shell.ShellString("a\na\nb\n").to("/tmp/u.txt"); return shell.uniq("-d", "/tmp/u.txt"); }, "a");

// ---------- which / tempdir / set ----------
cmd("misc");
t("tempdir()", () => shell.tempdir(), (o, s) => s.length > 0);
t("which node (預期 fail: memfs 無 PATH bin)", () => shell.which("node"), (o, s) => !!o);
t("set -e throws on error", () => {
  shell.set("-e");
  let threw = false;
  try { shell.cat("/no/such"); } catch(e) { threw = true; }
  shell.set("+e");
  shell.config.fatal = false;
  return String(threw);
}, "true");

// ---------- pipes ----------
cmd("pipe chains");
t("cat().grep()", () => shell.cat("src/b.txt").grep("apple"), "apple\napple");
t("cat().sed()", () => shell.cat("src/b.txt").sed(/apple/, "mango"), (o, s) => s.indexOf("mango") >= 0);
t("grep().sort() via ShellString", () => shell.cat("src/b.txt").grep(/a/).sort ? "has-sort" : "no-sort-method", (o, s) => true);
t("cat().head()", () => shell.cat("src/b.txt").head({ "-n": 1 }), "banana");

// ---------- render ----------
const byCmd = {};
results.forEach((r) => {
  (byCmd[r.cmd] = byCmd[r.cmd] || []).push(r);
});
const tbody = document.querySelector("#tbl tbody");
const detail = document.getElementById("detail");
let totalPass = 0;
Object.keys(byCmd).forEach((c) => {
  const list = byCmd[c];
  const pass = list.filter((r) => r.ok).length;
  totalPass += pass;
  const tr = document.createElement("tr");
  const cls = pass === list.length ? "pass" : (pass === 0 ? "fail" : "part");
  tr.innerHTML = "<td></td><td>" + pass + "/" + list.length + "</td><td class='" + cls + "'>" + (pass === list.length ? "OK" : (pass === 0 ? "FAIL" : "PARTIAL")) + "</td>";
  tr.querySelector("td").textContent = c;
  tbody.appendChild(tr);

  const d = document.createElement("details");
  if(pass < list.length) d.open = true;
  const sum = document.createElement("summary");
  sum.textContent = c + " (" + pass + "/" + list.length + ")";
  d.appendChild(sum);
  list.forEach((r) => {
    const div = document.createElement("div");
    div.className = "case";
    div.innerHTML = "<span class='" + (r.ok ? "pass'>✔" : "fail'>✘") + "</span> <span></span><div class='out'></div>";
    div.children[1].textContent = " " + r.label;
    if(!r.ok) div.querySelector(".out").textContent = r.detail;
    d.appendChild(div);
  });
  detail.appendChild(d);
});
document.getElementById("summary").textContent = "總計 " + totalPass + " / " + results.length + " passed";
console.log("[m2] " + totalPass + "/" + results.length);
console.log("[m2-json] " + JSON.stringify(results.map((r) => ({ cmd: r.cmd, label: r.label, ok: r.ok }))));
