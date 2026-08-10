// @plotdb/esh terminal library — createTerminal(el, opts)
// opts.worker: 自備 Worker 實例(vite 頁用); 否則以 opts.workerUrl 或
// 同目錄的 esh-worker.js 建立(bundle 成品的預設行為)
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { connectShell } from "./remote.js";
import "@xterm/xterm/css/xterm.css";

// iife 情境 import.meta 不可用, 以載入當下的 currentScript 為基準
let SCRIPT_BASE = "";
try { SCRIPT_BASE = import.meta.url || ""; } catch(e) { /* iife */ }
if(!SCRIPT_BASE && typeof document !== "undefined" && document.currentScript)
  SCRIPT_BASE = document.currentScript.src;

export function createTerminal(el, opts) {
  opts = opts || {};
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "Menlo, Monaco, monospace",
    fontSize: 14,
    theme: { background: "#11111b", foreground: "#cdd6f4", cursor: "#a6e3a1" }
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  fit.fit();
  term.focus();
  window.addEventListener("resize", () => fit.fit());
  el.addEventListener("click", () => term.focus());

  let worker = opts.worker;
  if(!worker) {
    const url = opts.workerUrl || new URL("esh-worker.js", SCRIPT_BASE).href;
    worker = new Worker(url, { type: "module" });
  }

  let cwd = "~", buf = "", busy = true, pending = "", sh = null;
  const history = [];
  let histIdx = -1, histStash = "";
  const home = opts.home || "/home/web";

  function promptStr() {
    const p = cwd.indexOf(home) === 0 ? "~" + cwd.slice(home.length) : cwd;
    return "\x1b[32m" + p + "\x1b[0m $ ";
  }
  function prompt() { term.write(promptStr()); }
  function writeBlock(s, colorErr) {
    if(!s) return;
    const t = s.replace(/\n$/, "").replace(/\n/g, "\r\n");
    if(!t) return;
    term.write(colorErr ? "\x1b[31m" + t + "\x1b[0m\r\n" : t + "\r\n");
  }

  // 0.2.0: 走 connectShell 標準協定(hello 握手, addEventListener 不搶
  // onmessage — 同一 worker 可同時給別的消費者用)
  connectShell(worker).then((c) => {
    sh = c;
    cwd = c.cwd;
    busy = false;
    (opts.banner || [
      "esh — embeddable shell runtime (全部跑在你的瀏覽器裡)",
      "/home 儲存: " + (c.ready.persist || "?"), ""
    ]).forEach((l) => term.writeln(l));
    prompt();
    if(pending) { const d = pending; pending = ""; handleData(d); }
  }).catch((e) => {
    term.writeln("\x1b[31mshell 連線失敗: " + e.message + "\x1b[0m");
  });

  function submit() {
    term.write("\r\n");
    const cmdline = buf;
    buf = "";
    histIdx = -1;
    if(!cmdline.trim()) { prompt(); return; }
    history.push(cmdline);
    busy = true;
    sh.run(cmdline).then((r) => {
      writeBlock(r.stdout, false);
      writeBlock(r.stderr, true);
      cwd = r.cwd;
      busy = false;
      prompt();
      if(pending) { const d = pending; pending = ""; handleData(d); }
    });
  }

  function setLine(s) {
    term.write("\x1b[2K\r" + promptStr());
    buf = s;
    term.write(s);
  }

  function handleData(data) {
    for(let i = 0; i < data.length; i++) {
      const c = data.charAt(i);
      const code = c.charCodeAt(0);
      if(c === "\r" || c === "\n") {
        submit();
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

  term.onData((data) => {
    if(busy) { pending += data; return; }
    handleData(data);
  });

  return { term, worker, focus: () => term.focus() };
}
