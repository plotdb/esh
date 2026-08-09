import "./process-fix.js";
import { vol } from "memfs";
import shell from "shelljs";
import { createContext, run } from "./interp.js";

shell.config.silent = true;

function seed() {
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

// ---------- 自動測試 ----------
const cases = [
  ["echo hello world", "hello world"],
  ["NAME=world; echo hi $NAME", "hi world"],
  ["NAME=x; echo \"quoted $NAME\"", "quoted x"],
  ["echo '$NAME'", "$NAME"],
  ["X=5; echo ${X}px", "5px"],
  ["echo ~", "/home/web"],
  ["cat README.md | grep needle", "find the needle here"],
  ["grep apple src/b.txt | sort | uniq", "apple"],
  ["ls src/*.js", "src/a.js"],
  ["echo out > /tmp/o.txt; cat /tmp/o.txt", "out"],
  ["echo a > /tmp/o.txt; echo b >> /tmp/o.txt; cat /tmp/o.txt", "a\nb"],
  ["sort -n < nums.txt | head -n 1", "2"],
  ["echo $(ls src | grep -v nested | head -n 1)", "a.js"],
  ["false && echo no || echo yes", "yes"],
  ["true && echo yes", "yes"],
  ["cd src && pwd", "/home/web/src"],
  ["sed s/apple/mango/ src/b.txt | head -n 2", "banana\nmango"],
  ["false; echo $?", "1"],
  ["wc -l README.md", "3"],
  ["grep needle src/*.txt README.md | sort", "find the needle here"],
  ["mkdir -p /tmp/zz/a && touch /tmp/zz/a/f.txt && ls /tmp/zz/a", "f.txt"],
  ["cat missing.txt 2> /tmp/err.txt; cat /tmp/err.txt", (s) => s.indexOf("missing.txt") >= 0],
  ["echo *", (s) => s.indexOf("README.md") >= 0 && s.indexOf("nums.txt") >= 0 && s.indexOf("src") >= 0],
  ["cat src/b.txt | sort > /tmp/s.txt; head -n 1 /tmp/s.txt", "apple"],
  ["X=inner echo $X", "inner"],
  ["test -f README.md && echo yes || echo no", "yes"],
  ["[ -d src ] && echo dir", "dir"],
  ["[ a = b ] || echo diff", "diff"],
  ["sed s/l/L/g src/a.js | grep conso", (s) => s.indexOf("consoLe.Log") >= 0],
  ["echo $(wc -l < nums.txt)", "4"],
  // field splitting
  ["FILES=\"README.md nums.txt\"; cat $FILES | wc -l", "7"],
  ["P=\"src/*.js\"; ls $P", "src/a.js"],
  ["X=\"one two\"; test \"$X\" = \"one two\" && echo same", "same"],
  ["echo $(ls src)", "a.js b.txt nested"],
  ["EMPTY=; echo $EMPTY hello", "hello"],
  // xargs
  ["ls src | xargs echo", "a.js b.txt nested"],
  ["echo README.md nums.txt | xargs cat | wc -l", "7"],
  ["ls src | xargs -n 1 echo x", "x a.js\nx b.txt\nx nested"],
  ["ls src/*.txt | xargs -I {} cp {} /tmp && ls /tmp/b.txt", "/tmp/b.txt"]
];

const casesDiv = document.getElementById("cases");
let passed = 0;
cases.forEach(([cmdline, expect]) => {
  seed();
  const ctx = createContext();
  const r = run(cmdline, ctx);
  const got = (r.stdout || "").replace(/\n+$/, "");
  const ok = typeof expect === "function" ? !!expect(got) : got === expect;
  if(ok) passed++;
  const div = document.createElement("div");
  div.className = "case";
  div.innerHTML = "<span class='" + (ok ? "pass'>✔" : "fail'>✘") + "</span> <span class='cmd'></span><pre class='out'></pre>";
  div.querySelector(".cmd").textContent = " $ " + cmdline;
  div.querySelector(".out").textContent = ok ? got : "got:  " + got + (r.stderr ? "\nstderr: " + r.stderr : "") + "\nwant: " + (typeof expect === "function" ? "(predicate)" : expect);
  casesDiv.appendChild(div);
});
document.getElementById("summary").textContent = passed + " / " + cases.length + " passed";
console.log("[m25] " + passed + "/" + cases.length);

// ---------- REPL ----------
seed();
const replCtx = createContext();
const log = document.getElementById("log");
const input = document.getElementById("input");
const prompt = document.getElementById("prompt");
function refreshPrompt() { prompt.textContent = String(shell.pwd()) + " $ "; }
refreshPrompt();
input.addEventListener("keydown", (ev) => {
  if(ev.key !== "Enter") return;
  const cmdline = input.value;
  input.value = "";
  const r = run(cmdline, replCtx);
  const entry = document.createElement("div");
  entry.innerHTML = "<span class='cmd'></span><div class='out'></div><div class='err'></div>";
  entry.querySelector(".cmd").textContent = prompt.textContent + cmdline;
  entry.querySelector(".out").textContent = (r.stdout || "").replace(/\n+$/, "");
  entry.querySelector(".err").textContent = r.stderr || "";
  log.appendChild(entry);
  refreshPrompt();
  log.scrollTop = log.scrollHeight;
});
window.sh = (s) => run(s, replCtx);
console.log("[m25] REPL ready — 頁面下方輸入框或 console 的 sh('...') 皆可");
