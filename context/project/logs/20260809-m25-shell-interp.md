# 20260809 — M2.5: shell 語法直譯層 PoC

## 結果:39/39 通過(30 項一次全綠;後補 field splitting + xargs 共 9 項)

測試頁:poc-shelljs/m25.html(30 個自動測項 + 頁面底部互動 REPL;
console 亦有 `sh("...")` 可直接呼叫)

## 架構

- **parser**:bash-parser(posix mode)→ AST。純 JS,瀏覽器直接跑,零問題。
- **evaluator**:src/interp.js(~350 行)。AST walk:
  Script/CompoundList(; 串接)、LogicalExpression(&& ||)、
  Pipeline(stdout→stdin 字串傳遞)、Command、Subshell。
- **builtins registry**:`(argv, stdin, ctx) → {stdout, stderr, code}`。
  echo/pwd/cd/cat/grep/sed/sort/head/tail/uniq/wc/test/[/true/false/
  export/unset/env 為包裝實作;ls/find/mkdir/rm/cp/mv/touch/chmod/ln
  直接轉送 shelljs(dash 選項由 shelljs 解析)。
  此 registry 即 Track 2 WASM 工具未來的掛載點。

## 驗證涵蓋

$VAR、${X}、單/雙引號語意、~ 展開、glob(fast-glob 對 memfs)、
> >> < 2> redirect、pipe、; && ||、$(...) command substitution(含巢狀
pipe 與 `$(wc -l < f)`)、$?、暫時性賦值(X=v cmd)、export、
test/[ ]、sed s///g 表達式翻譯(→ ShellJS regex API)。

## 關鍵實作筆記

1. **同步紅利成立**:所有指令同步 → pipe 是字串傳遞、$( ) 是遞迴呼叫,
   直譯器完全沒有非同步協調問題。這是本架構相對 WebContainers 的最大簡化。
2. **bash-parser 的引號行為不一致**:單引號在 .text 已剝除(且無 expansion
   標記),雙引號保留在 .text 中、expansion loc 含引號 offset。
   處理方式:expansion 先換成 \x00N\x00 placeholder → 剝雙引號 →
   以 literal 區段判斷 glob 資格 → 最後代回值。
3. **sed 表達式要自己翻譯**:ShellJS sed 吃 (regex, replacement),
   parseSedExpr 處理任意 delimiter + escape + g/i flags。
4. **field splitting 已補做**:expansion 機制重寫為 segment-based
   (逐字掃描追蹤雙引號區域,每段標記 quoted/expansion)。未加引號的
   expansion 結果按空白切欄,切完逐欄 glob(含 P="src/*.js"; ls $P
   這種 expansion 結果 glob 的 POSIX 行為);引號內不切不 glob。
   空展開(echo $EMPTY hello)正確消失。
5. **xargs 已實作**(-n / -L / -I placeholder):在本架構下「執行指令」
   只是查 builtin registry 呼叫函式,不需要 fork/exec —
   這正是 BusyBox/WASM 路線做不到 xargs 而我們可以的原因。
6. 未做(明確範圍外):control flow(if/for/while, 層 3)、
   job control(層 4)、heredoc、IFS 自訂(固定空白切欄)。

## 結論

shell 語法層可行性驗證完成,層 1-2 全數通過。加上 M1/M2,
「純前端 shell」的三個核心組件(指令、fs、語法)都已個別驗證。
