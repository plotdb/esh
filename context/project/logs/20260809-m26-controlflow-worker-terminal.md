# 20260809 — M2.6: control flow(層 3)+ Worker 架構 + xterm.js 終端

## 結果

- m25.html 測項 39 → 55,全數通過(if/elif/for/while/break/continue/
  case/function/positional params/$#/return)
- terminal.html:xterm.js 終端 + shell 跑在 Web Worker,
  實測 pipe、function 定義呼叫、for+glob、cd 狀態、歷史(上下鍵)全部正常

## Control flow 實作(interp.js)

- evalNode 新增 If/For/While/Until/Case/Function case
- break/continue/return 以 exception 訊號逐層上拋(BreakSig 等),
  For/While/callFunction 捕捉;break N/continue N 支援
- function:body AST 存 ctx.funcs,呼叫時換 ctx.positional($1..$N、$#),
  函式優先於同名 builtin(bash 語意)
- case pattern 用 globToRegExp 比對
- while 有 MAX_LOOP=100000 保險(瀏覽器凍結防護)

## 踩到的 bash-parser bug(x2,都在 interp.js 內 workaround)

1. **巢狀 compound 同行 parse 失敗**:`for ...; do if ...; then` 之類
   一行式必掛("Unexpected Then"),換行寫法正常。
   解法:parse 前 normalizeSemicolons() —
   引號外單一 `;` → 換行(保留 `;;`),且 do/then/else/{ 後接
   if/for/while/until/case 時補換行。token 級掃描,引號內不動。
2. **幽靈 expansion**:換行後的指令 Word 會殘留前一行的 expansion 標記,
   loc 為負數(如 `greet` 上掛 start:-5),直接用會把字咬掉("eet")。
   解法:過濾 expansion — loc 需合法且該位置字元確為 $ 或 `。

## Worker + 終端架構

- src/shell.worker.js:interp + memfs + seed 全在 worker,
  協定 {id, type:'exec', cmdline} → {id, 'result', stdout, stderr, code, cwd}
- src/terminal.js:xterm.js + FitAddon,本地 line editing
  (backspace/^C/^L/上下鍵歷史),busy 期間輸入進 pending 緩衝
- vite.config 需加 worker: { format:'es', plugins: () => [nodePolyfills(...)] }
  (worker bundle 是獨立 pipeline,alias 共用但 plugin 要另掛)

## 除錯備忘

- Claude in Chrome 的合成鍵盤事件進不了 xterm 的 helper textarea
  (真人鍵盤正常);自動化測試改用 JS dispatch InputEvent/KeyboardEvent。
- 瀏覽器分頁若 extension script injection timeout,先開新分頁再判斷
  是否真的死圈 — 這次一小時的「假 hang」其實是舊分頁 extension 卡住。

## 未做

- OPFS 持久化(下一步,見 plan)
- heredoc、自訂 IFS、算術展開 $(( ))、local 變數 scope
