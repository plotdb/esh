import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const term = new Terminal({
  cursorBlink: true,
  fontFamily: "Menlo, Monaco, monospace",
  fontSize: 14,
  theme: { background: "#11111b", foreground: "#cdd6f4", cursor: "#a6e3a1" }
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById("term"));
fit.fit();
term.focus();
window.addEventListener("resize", () => fit.fit());
document.addEventListener("click", () => term.focus());

const worker = new Worker(new URL("./shell.worker.js", import.meta.url), { type: "module" });

let cwd = "~", buf = "", busy = true, msgId = 0;
const history = [];
let histIdx = -1, histStash = "";

function promptStr() {
  const p = cwd.replace(/^\/home\/web/, "~");
  return "\x1b[32m" + p + "\x1b[0m $ ";
}
function prompt() { term.write(promptStr()); }
function writeBlock(s, colorErr) {
  if(!s) return;
  const t = s.replace(/\n$/, "").replace(/\n/g, "\r\n");
  if(!t) return;
  term.write(colorErr ? "\x1b[31m" + t + "\x1b[0m\r\n" : t + "\r\n");
}

worker.onmessage = (ev) => {
  const m = ev.data;
  if(m.type === "ready") {
    cwd = m.cwd;
    busy = false;
    term.writeln("browser-shell — ShellJS + memfs + bash-parser, 全部跑在你的瀏覽器裡");
    term.writeln("試試: ls / cat README.md | grep needle / for f in src/*; do wc -l $f; done");
    term.writeln("");
    prompt();
    if(pending) { const d = pending; pending = ""; handleData(d); }
    return;
  }
  if(m.type === "result") {
    writeBlock(m.stdout, false);
    writeBlock(m.stderr, true);
    cwd = m.cwd;
    busy = false;
    prompt();
    if(pending) { const d = pending; pending = ""; handleData(d); }
  }
};

function submit() {
  term.write("\r\n");
  const cmdline = buf;
  buf = "";
  histIdx = -1;
  if(!cmdline.trim()) { prompt(); return; }
  history.push(cmdline);
  busy = true;
  worker.postMessage({ id: ++msgId, type: "exec", cmdline });
}

function setLine(s) {
  term.write("\x1b[2K\r" + promptStr());
  buf = s;
  term.write(s);
}

let pending = "";
term.onData((data) => {
  if(busy) { pending += data; return; }
  handleData(data);
});

function handleData(data) {
  for(let i = 0; i < data.length; i++) {
    const c = data.charAt(i);
    const code = c.charCodeAt(0);
    if(c === "\r" || c === "\n") {
      submit();
      // 執行中: 剩餘輸入進 pending, 由 result handler 接續
      if(busy) { pending = data.slice(i + 1) + pending; return; }
      continue;
    }
    if(code === 127) {
      if(buf.length) { buf = buf.slice(0, -1); term.write("\b \b"); }
      continue;
    }
    if(code === 3) { term.write("^C\r\n"); buf = ""; histIdx = -1; prompt(); continue; }
    if(code === 12) { term.clear(); continue; }
    if(code === 27) {
      const seq = data.slice(i, i + 3);
      if(seq === "\x1b[A") {
        if(history.length && histIdx < history.length - 1) {
          if(histIdx === -1) histStash = buf;
          histIdx++;
          setLine(history[history.length - 1 - histIdx]);
        }
        i += 2; continue;
      }
      if(seq === "\x1b[B") {
        if(histIdx > -1) {
          histIdx--;
          setLine(histIdx === -1 ? histStash : history[history.length - 1 - histIdx]);
        }
        i += 2; continue;
      }
      if(seq === "\x1b[C" || seq === "\x1b[D") { i += 2; continue; }
      continue;
    }
    if(code >= 32) { buf += c; term.write(c); }
  }
}
