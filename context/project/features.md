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

## 自訂指令(0.0.2, async 自 0.1.0)

- 簽名同 builtin:`(argv, stdin, ctx) → {stdout, stderr, code}`;
  寬鬆回傳:字串視為 stdout(code 0)、undefined 視為成功空輸出。
  自動參與 pipe/redirect/$( )(皆為字串傳遞)。
- **可為 async**(0.1.0 起):回傳 Promise 會被等待, reject → stderr + code 1。
  `sh.run()` 因此一律回 Promise(evaluator 全 async)。
- per-shell(主要):`createShell({commands: {...}})` 或
  `sh.registerCommand(name, fn)` / `sh.registerCommand({name: fn, ...})`,
  掛在 ctx.commands, shell 間互不可見。
- 全域(預留):`registerCommand(...)` 從 entry re-export
  (core 的 globalCommands, 同 realm 所有 shell 共用, 慎用)。
- 查找順序:shell function → per-shell → 全域 → builtins。
- worker/終端:function 過不了 postMessage — esh-term 要自訂指令得自備
  worker(createTerminal 的 opts.worker 縫已存在);
  worker 底座抽用(esh-worker-base)為未來項目。
  worker 內 async 指令可 await postMessage 往返向主執行緒要資料/UI 互動
  (0.0.x 時代需 SAB+Atomics+coi-sw 同步阻塞, 0.1.0 起不再需要)。

## git(0.3.0, optional command pack)

- `@plotdb/esh/git`:`gitCommands(opts)` / `installGit(sh, opts)`,
  per-shell 註冊;isomorphic-git 實作, 主 entry 不含(check-bundle 把關)。
- 指令:init / config / add / status / commit -m / log / branch /
  checkout(僅 branch/tag)。network(clone/pull/push)另案。
- commit author:repo config(git config user.name/email)→
  opts.author → 明確報錯。
- 自訂指令 ctx 新增 `ctx.esh = {fs, cwd}`(base 注入, subshell 繼承)—
  想碰檔案的自訂指令用這個, 不只 git。
- worker 邊界:function 過不了 postMessage — git 只能裝在自己
  createShell 的一側;esh-term 預設 worker 不含 git。
- OPFS 注意:剛寫入(尤其 symlink)可能晚一 tick 才被 statusMatrix
  看到;symlink 本身 commit/checkout roundtrip 驗證 OK(mode 120000)。

## scoped root 與 device backend(0.4.0)

- `createShell({root})` / `sh.chroot(p)`:per-shell root, shell 指令與 io
  全關在 root 內("/" 即 root;cd .. / 絕對路徑 / glob / find 穿不出去)。
  同一份 fs 可多 shell 各自不同 root, 互見寫入。chroot 為 host 端 JS API。
  僅瀏覽器 bundle(zenfs bindContext + withFsScope);Node 給 root 會報錯。
- `{backend: 'device', files: {name: {read, write?}}}`:callback-backed
  檔案(char device, 無鏡像無快取, stat size 每次物化);無 write → EROFS;
  整檔 read/write。rooted shell 要看 device → 掛在 root 內路徑。
  device 為 volatile — 消費端可用 stat.mode(S_IFCHR)判斷。
- 設計與驗收:tasks/scoped-root-and-device-backend.md。

## 跨執行緒協定 serveShell / connectShell(0.2.0)

- shell 側 `serveShell(sh, target, info?)`、使用側
  `connectShell(workerOrUrl)` → Promise<{run, io, cwd, ready, worker,
  dispose}> — 與 createShell 同形狀子集, 消費端 local/remote drop-in。
- 協定:exec 沿用 worker 既有格式;`{type:'fs', op, args}` 傳內容
  (白名單僅 readFile/writeFile — 路徑操作走 exec, 內容不經 shell parser;
  append 用 read+concat+write, 同一 queue 序列化無 race);
  `{type:'hello'}` 握手(重試, 不依賴初始 ready 廣播)。
- binary:writeFile 收 string | Uint8Array;readFile encoding 預設
  utf8 回 string, null/'binary' 回 Uint8Array(structured clone 原生)。
- 多 client:同一 worker 可掛多個 connectShell(id 隨機前綴過濾廣播);
  serveShell 用 addEventListener, 使用方自己的協定可並存
  (type 避開 exec/fs/hello)。
- transport-agnostic:target 只需 postMessage/addEventListener 形狀,
  跨裝置可自寫 adapter(序列化自理)。
- 本地對應:`sh.io.readFile/writeFile`(promise, 同簽名)、`sh.cwd()`。
- dogfooding:esh-worker 以 serveShell 實作、term client 以 connectShell。

## fs

- ZenFS(@zenfs/core),shim 修補六項行為差異(相對路徑 cwd hook、
  readdir 排序、symlink null type、目錄 chmod EISDIR 靜默、
  chdir 驗證目標存在且為目錄 — 0.3.0, 否則 cd 不存在路徑會誤成功、
  hardenAsyncMounts — 0.3.2, zenfs Async mixin 的 replay 偵測在 bundle 後
  失效導致 OPFS 上 sync 寫入靜默清空檔案, 見 tasks/opfs-sync-write-loss.md)
- redirect(`>`/`>>`)走 async 寫 + 回讀驗證(0.3.2),失敗回
  stderr + code 1;writeFileSync 寫後驗 size(失真丟 EIO)
- 掛載:/home → OPFS(WebAccess, 持久)、/tmp → InMemory(預設)
- Node 宿主可換 memfs 做沙箱(需自行確保 fs/shell 同世界)

## 測試矩陣(迴歸網, 動 interp/shim 必跑)

- /web/vitedev/m2.html — 指令存活表 80/81(vite)
- /web/vitedev/m25.html — 語法 72/72(vite;?from=N&to=M 可切片 bisect)
- /web/vitedev/terminal.html — worker+OPFS 實機(vite)
- web/static/bundle-test.html — dist 成品 8/8(零 bundler)
- / (index.pug) — 終端主畫面 + tests popup 5/5(npm start)
- `npm test` — Node async-core 迴歸(並發 run 序列化/展開鏈/reject/
  async×語法混合 21 測項;test/async-core.mjs, 零瀏覽器)
  + remote 協定 17 測項(晚掛握手/多 client/並存/序列化/binary/dispose;
  test/remote.mjs, loopback 假 target)
- web/static/async-test.html — dist 成品時序測試(A 並發序列化/B 展開鏈/
  C reject/D worker 佇列;時序機制要兩件事同時在飛才測得到, 故獨立成頁)
- Node:`node --input-type=module -e "import('./src/node-entry.js')..."`

## 已知限制與注意

- exec()/which 不支援(架構性)
- chmod -R 下目錄本身 mode 不變(ZenFS EISDIR 妥協)
- 引號內 glob 字元不展開判斷以「整個 word 含雙引號」概判(保守)
- initDeps 單實例:同一 JS realm 只能綁一組依賴
- bash-parser 三個 bug 由 interp 內 workaround:巢狀 compound 一行式
  (分號正規化)、幽靈 expansion(負 loc 過濾)、heredoc body 丟失(前處理)
