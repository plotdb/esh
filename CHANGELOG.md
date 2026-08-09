# CHANGELOG

## master

 - features:
   - poc-shelljs: ShellJS + memfs 於瀏覽器執行(Vite alias fs/process/os/execa 四組 shim)
   - poc-shelljs: M2 指令存活表(81 測項, /m2.html)
   - poc-shelljs: shell 語法直譯層 interp.js — bash-parser + evaluator,
     支援 $VAR/引號/glob/redirect/pipe/&& ||/$( )/$?(/m25.html, 互動 REPL)
   - interp: field splitting(segment-based expansion 重寫)與 xargs(-n/-L/-I)
   - interp: control flow 層 3 — if/elif/for/while/until/case/function/
     break/continue/return/positional params(m25 測項 55/55)
   - terminal: xterm.js 終端(terminal.html),shell 直譯器移入 Web Worker
   - fs: memfs → ZenFS 換底(fs-zen-shim),/home 掛 OPFS 持久化,
     /tmp 留 InMemory;seed 抽共用 src/seed.js,fs 存取一律走 alias
   - interp: 語法邊角 — $(( )) 算術、test 數值比較、$@/"$@"、local、
     自訂 IFS、heredoc(parse 前抽出 + 延後展開)、escape(m25 72/72)
 - bug fix:
   - workaround bash-parser 巢狀 compound 一行式 parse 失敗(分號正規化為換行)
   - workaround bash-parser 換行後幽靈 expansion(負數 loc 過濾)
 - docs:
   - context/project: plan(兩條路線)、index、M1/M2/M2.5/M2.6 工作記錄
