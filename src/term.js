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

  // ---- tab 補全 (0.4.1) ----
  // 第一個 token (含 | && ; 之後) 補指令, 其餘補路徑 — 候選經 exec 協定問
  // worker 的 __complete builtin。單候選直補 (目錄加 /、指令加空白)、
  // 多候選補公共前綴、同一行連按兩次列出清單。
  // v1 限制: 不處理含空白/引號的檔名、不補 flag。
  let lastTabBuf = null;
  function tokenContext() {
    // 目前 token = 最後一個空白之後; 之前最近的非空白若是 | & ; ( 則為指令位置
    const at = buf.lastIndexOf(" ");
    const token = buf.slice(at + 1);
    const before = buf.slice(0, at + 1).replace(/\s+$/, "");
    const isCmd = before === "" || /[|&;(]$/.test(before);
    return { token, isCmd };
  }
  function handleTab() {
    if(busy || !sh) return;
    const { token, isCmd } = tokenContext();
    if(token.indexOf("'") >= 0 || token.indexOf('"') >= 0) return; // v1 不處理引號
    let q;
    const slash = token.lastIndexOf("/");
    const dir = slash >= 0 ? token.slice(0, slash + 1) : "";
    const base = slash >= 0 ? token.slice(slash + 1) : token;
    if(isCmd && slash < 0) q = "__complete cmd '" + token + "'";
    else q = "__complete path '" + (dir || ".") + "' '" + base + "'";
    busy = true;
    sh.run(q).then((r) => {
      busy = false;
      const cands = (r.stdout || "").split("\n").filter(Boolean);
      const prefix = isCmd && slash < 0 ? token : base;
      if(!cands.length) { lastTabBuf = null; return; }
      if(cands.length === 1) {
        const c = cands[0];
        let add = c.slice(prefix.length);
        if(c.charAt(c.length - 1) !== "/") add += " ";
        buf += add;
        term.write(add);
        lastTabBuf = null;
        return;
      }
      // 公共前綴延伸
      let common = cands[0];
      cands.forEach((c) => { while(common && c.indexOf(common) !== 0) common = common.slice(0, -1); });
      if(common.length > prefix.length) {
        const add = common.slice(prefix.length);
        buf += add;
        term.write(add);
        lastTabBuf = null;
        return;
      }
      // 無可延伸: 連按兩次才列清單
      if(lastTabBuf === buf) {
        term.write("\r\n" + cands.join("  ") + "\r\n");
        prompt();
        term.write(buf);
        lastTabBuf = null;
      } else lastTabBuf = buf;
    }).catch(() => { busy = false; });
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
      if(code === 9) { handleTab(); continue; }
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
