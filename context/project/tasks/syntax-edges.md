# shell 語法邊角 todo

直譯器(poc-shelljs/src/interp.js)語法邊角。20260810 全數完成,
測項在 src/m25.js(72/72)。

## 已完成(20260810)

- [x] `$(( ))` 算術展開 — evalArith 走 bash-parser 的 babel AST;
  支援四則/比較/邏輯/三元/賦值(i=, +=)/++ --;比較回傳 1/0,
  除法 trunc,除以零丟錯。順帶補 test/[ 的 -lt -le -gt -ge -eq -ne。
- [x] `$@` / `$*` / `"$@"` — kind positional-list;unquoted 走一般
  field split,quoted "$@" 每參數獨立成欄(可與相鄰片段黏合)。
- [x] `local` — ctx.scopes 疊 frame,callFunction 進出 push/pop 還原;
  function 外使用回報錯誤。
- [x] 自訂 IFS — field splitting 依 ctx.vars.IFS 建字元類(IFS= 不切)。
  修 bug:空展開(-$y-)不該切欄。
- [x] heredoc `<<EOF` / `<<-` / `<<'EOF'` — **bash-parser 會把 body 整個
  丟掉**,故 parse 前自行抽出:body 寫 /tmp/.heredoc-N,`<<D` 改寫成
  `< 檔案`;未加引號 delimiter 的 $VAR 展開延後到讀取時做
  (同行 NAME=w; cat <<EOF 才來得及)。<<- 剝行首 tab。
- [x] escape(`\$` `\ `)— bash-parser 在 parse 層已處理,補測項確認即可。

## 明確不做(除非有需求)

- job control(`&`/fg/bg)— 瀏覽器無 process 概念
- `${VAR:-default}` 等參數展開變體 — 用到再說
- process substitution `<( )`、coproc、trap/signal

## 相關

- logs/20260810-syntax-edges.md(實作記錄)
- bash-parser 已知 bug:巢狀 compound、幽靈 expansion、heredoc body 丟失
