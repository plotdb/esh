# CHANGELOG

## master

 - features:
   - poc-shelljs: ShellJS + memfs 於瀏覽器執行(Vite alias fs/process/os/execa 四組 shim)
   - poc-shelljs: M2 指令存活表(81 測項, /m2.html)
   - poc-shelljs: shell 語法直譯層 interp.js — bash-parser + evaluator,
     支援 $VAR/引號/glob/redirect/pipe/&& ||/$( )/$?/field splitting/xargs
     (39 測項 + 互動 REPL, /m25.html)
 - docs:
   - context/project: plan(兩條路線)、index、M1/M2/M2.5 工作記錄
