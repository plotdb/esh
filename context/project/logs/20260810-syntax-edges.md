# 20260810 — 語法邊角一次做完(m25 測項 55 → 72,全綠)

依 tasks/syntax-edges.md 順序實作,重點記錄:

## $(( )) 算術

bash-parser 的 ArithmeticExpansion 附 babel-style AST(BinaryExpression/
Identifier/NumericLiteral...),evalArith 直接 walk,約 90 行。
bash 語意:比較回傳 1/0、/ 為 trunc 整數除、&& || 回傳 1/0、
支援賦值形式($((i+=1)))與 ++ --。變數未定義視為 0。
同時補 test/[ 的數值比較 -lt -le -gt -ge -eq -ne —
自此 `while [ $i -lt 3 ]` + `i=$((i+1))` 計數迴圈完整可用。

## "$@"

quoted "$@" 在 segment 標記 list,expandWordToFields 對每個參數獨立成欄;
f "a b" c 經 "$@" 轉傳保持兩個參數不碎裂。unquoted $@/$* join 後走
一般 field split。

## local / IFS

- local:ctx.scopes 疊 frame,記錄舊值,callFunction finally 還原。
- IFS:切欄 regex 從 ctx.vars.IFS 動態建;IFS= 空字串停用切欄。
- 修到一個既有 bug:空展開不該產生欄界(`-$y-` 曾變成 "- -")。

## heredoc(bash-parser 第三個雷)

**bash-parser parse heredoc 時把 body 整個丟掉**(suffix 只剩 << token)。
解法:parse 前自行逐行掃描抽出 body → 寫 /tmp/.heredoc-N →
`<<DELIM` 改寫為 `< /tmp/.heredoc-N`。
細節:
- 未加引號 delimiter 需展開 $VAR — 但不能在 parse 前做
  (`NAME=w; cat <<EOF` 同行賦值還沒生效),用 heredocExpand registry
  標記檔案,evalCommand 讀入時才展開。
- <<-EOF 剝行首 tab;<<'EOF' 不展開。

## escape

bash-parser 在 parse 層已把 `\$HOME` → 純文字、`a\ b` → 單一 word 處理好,
evaluator 不需動,補測項鎖行為。

## 狀態

- m25:72/72(算術 7、$@ 2、local 2、IFS 1、heredoc 3、escape 2 新增)
- m2:80/81(無退化)
- 語法層至此涵蓋日常 script 的絕大多數寫法;明確不做清單見 tasks。
