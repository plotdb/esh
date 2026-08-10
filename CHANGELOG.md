# Change Logs

## v0.0.1

 - tweaks:
   - 移除 poc-shelljs/(內容已全數遷移, git history 保留完整演進)
 - features:
   - esh-term: 終端隨主套件分檔出貨(dist/esh-term.{js,iife.js,css} +
     esh-worker.js), createTerminal(el, opts); vite 頁與 bundle 共用 src/term.js;
     web/ demo(index.pug)改為終端主畫面 + tests popup dialog
   - 套件化: 定名 @plotdb/esh, esh/ 結構整理後拉至 repo 根目錄
     (src/tools/web;vite 測試頁移 web/dev/;dist 出 esm + iife 雙格式,
     web/ 走 fedev 慣例消費成品;poc-shelljs/ 保留為歷史參照)
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
   - 兩層式打包: core 零 import 化(initDeps 注入)+ base.js factory
     (bsh(ctx))+ bundle-entry/esbuild script → self-contained ESM
     (零 bundler 可用, gzip 226KB;bundle-test.html 8/8)
 - bug fix:
   - workaround bash-parser 巢狀 compound 一行式 parse 失敗(分號正規化為換行)
   - workaround bash-parser 換行後幽靈 expansion(負數 loc 過濾)
 - docs:
   - context/project: plan(兩條路線)、index、M1/M2/M2.5/M2.6 工作記錄
