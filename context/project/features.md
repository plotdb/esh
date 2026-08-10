# features — 目前系統的機制與功能

(2026-08-10 snapshot, commit 0a00fab 前後)

## 架構

    bundle-entry.js ──► base.js(esh(ctx) factory)──► core.js(直譯器, 零 import)
    node-entry.js  ──┘        │
    term-entry.js ──► term.js(createTerminal)──► shell.worker.js(worker 內跑 core)
                              │
    shims: fs-zen-shim(ZenFS+修補)/ process-shim / os-shim /
           execa-shim / child_process-shim / global-inject

- **core.js**:直譯器 + builtin registry。零 import,依賴以
  `initDeps({parse, shell, fs, fg})` 注入(模組級單實例)。
- **base.js**:`esh(ctx)` — 依賴檢查 + fs/shell 同世界 sanity check,
  回傳 `{run, context, createContext, fs}`。
- **bundle-entry.js**:瀏覽器成品入口。`createShell({mounts})` 掛載捷徑:
  opfs / indexeddb / memory / 原生 zenfs 設定。
- **node-entry.js**:Node 宿主,零墊片(shelljs 的 require('fs') 天然解析)。
- **term.js**:xterm 終端(line editing/歷史/^C/^L),worker 自備或由
  同目錄 esh-worker.js 解析(iife 用 currentScript 定位)。

## 出貨產物(npm run build)

- `dist/esh.js` / `dist/esh.iife.js`(window.esh)— 引擎
- `dist/esh-term.js` / `.iife.js`(window.eshTerm)+ 各自 .css — 終端
- `dist/esh-worker.js` — worker 成品(含完整引擎)
- 全部自動複製到 `web/static/assets/esh/`
- 體積參考:引擎 ~1.7MB / minify 788KB / gzip 226KB
- exports:`.`(browser→dist, default→node-entry)、`./base`、`./core`、
  `./term`、`./term/iife`、`./worker`;`unpkg` 指 iife

## 支援語法(m25, 72 測項)

pipe、redirect(> >> < 2>)、heredoc(<<EOF/<<-/<<'EOF')、
$VAR/${V}/引號語意/escape、glob(fast-glob)、field splitting(IFS 可自訂)、
$(...) command substitution、$(( )) 算術(含賦值/++/--)、
; && ||、$? $# $@ "$@" $1..$N、if/elif/for/while/until/case、
function/return/local、break/continue(含層數)、export/unset、~ 展開

## 指令(m2 存活表, 81 測項)

- shelljs 轉送:ls find mkdir rm cp mv touch chmod ln cd pwd
  pushd popd dirs cat grep sed sort head tail uniq
- 自製:echo wc test/[ xargs(-n/-L/-I) true false export unset local env
- 不支援:exec(無 child_process)、which(無 PATH 執行檔)

## fs

- ZenFS(@zenfs/core),shim 修補四項行為差異(相對路徑 cwd hook、
  readdir 排序、symlink null type、目錄 chmod EISDIR 靜默)
- 掛載:/home → OPFS(WebAccess, 持久)、/tmp → InMemory(預設)
- Node 宿主可換 memfs 做沙箱(需自行確保 fs/shell 同世界)

## 測試矩陣(迴歸網, 動 interp/shim 必跑)

- /web/vitedev/m2.html — 指令存活表 80/81(vite)
- /web/vitedev/m25.html — 語法 72/72(vite;?from=N&to=M 可切片 bisect)
- /web/vitedev/terminal.html — worker+OPFS 實機(vite)
- web/static/bundle-test.html — dist 成品 8/8(零 bundler)
- / (index.pug) — 終端主畫面 + tests popup 5/5(npm start)
- Node:`node --input-type=module -e "import('./src/node-entry.js')..."`

## 已知限制與注意

- exec()/which 不支援(架構性)
- chmod -R 下目錄本身 mode 不變(ZenFS EISDIR 妥協)
- 引號內 glob 字元不展開判斷以「整個 word 含雙引號」概判(保守)
- initDeps 單實例:同一 JS realm 只能綁一組依賴
- bash-parser 三個 bug 由 interp 內 workaround:巢狀 compound 一行式
  (分號正規化)、幽靈 expansion(負 loc 過濾)、heredoc body 丟失(前處理)
