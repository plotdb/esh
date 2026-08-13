# browser-shell:在純前端提供 shell / coreutils 能力

## 背景

- StackBlitz WebContainers / CodeSandbox Nodebox 能在瀏覽器跑 Node,但閉源且商用授權不友善。
- 實測(2026-08-09, stackblitz.com 的 jsh)確認:其 shell 只有 coreutils 子集
  (有 ls/cat/cp/mv/rm/mkdir/sort/tail/curl/jq;沒有 grep/sed/awk/git/uname),
  缺的可用純 JS npm 套件補(已驗證 shx 裝完即可直接呼叫)。
- 目標:不依賴 WebContainers,在「一般網頁的 JS 環境」(無 Node API)提供
  shell 指令能力,搭配虛擬檔案系統,商用授權乾淨。

## 兩條實驗路線

### Track 1: ShellJS + virtual fs(JS 生態整合路線)

假設:ShellJS 九成指令只依賴 `fs` + `path` + JS regex,把 fs 換成瀏覽器內
虛擬檔案系統即可運作,不需改 ShellJS 原始碼。

- 虛擬 fs:memfs(首選,fs API 完整、sync 天然成立)或 ZenFS。
- 打包:Vite alias — `fs` → memfs、`path` → path-browserify、`os` → 小 stub
  (homedir/platform/EOL)。
- `exec()` 直接 stub 丟明確錯誤(依賴 child_process,瀏覽器無解,不模擬)。
- 驗收:在瀏覽器(或 vitest + happy-dom)跑 ShellJS 官方測試套件,
  產出「指令存活表」— 哪些指令全綠、哪些部分、哪些死。
- 紅利:同一個 memfs instance 可共用給 isomorphic-git(前端 git)。
- 已知限制:grep/sed 是 JS regex 近似品,非 POSIX BRE/ERE;
  持久化需 OPFS/IndexedDB(async)— 同步存取只在 Web Worker 可行
  (OPFS createSyncAccessHandle),若要持久化,架構需早決定
  「shell 跑在 worker、主執行緒 postMessage」。
- 授權:ShellJS BSD-3、shx MIT、memfs Apache-2.0/Unlicense — 商用 OK。

### Track 2: WASM build 的真 coreutils(語意保真路線)

假設:要 POSIX 語意正確的 grep/sed/awk,用真實作編成 WASM 比 JS 近似品可靠。

候選(擇一先試,建議 uutils):

- **uutils/coreutils**(Rust 重寫 coreutils,MIT):
  `cargo build --target wasm32-wasip1`,單一 multicall binary 或逐指令編。
  Rust → WASI 工具鏈成熟,是首選。
- **BusyBox**(GPL-2.0):C 原始碼,經 wasi-sdk 編譯,社群已有先例。
  優勢:單一 multicall binary 就含 grep/sed/awk/find/tar 等完整工具鏈,
  直接解掉 uutils 缺 text tools 的洞;語意是數十年實戰過的。
  授權評估:以獨立 .wasm asset 形式呼叫(類似獨立程式),GPL 不傳染到
  應用程式碼,但散布 .wasm 給瀏覽器算 distribution,需依 GPL-2.0
  提供該 binary 的對應原始碼(通常附連結即可);公司若全面禁 GPL 則出局。
  技術風險:wasm32-wasip1 沒有 fork/exec,BusyBox 的 ash shell 重度依賴
  fork → shell 本體大概率跑不了,只能逐 applet 呼叫(每次執行一個指令),
  編譯也需要 patch(tty/signal 相關)。

共通需求:

- WASI shim:瀏覽器端跑 WASI 需 polyfill(候選:@bjorn3/browser_wasi_shim、
  @wasmer/wasi),把 WASI 的 fd/path open 系列 syscall 接到虛擬 fs。
- 關鍵整合點:讓 Track 2 的 WASI fs 與 Track 1 的 memfs 共用同一份資料
  (寫一層 memfs ↔ WASI preopens 的 adapter),否則兩邊各一個世界。
- 驗收:grep(BRE/ERE/-r/-v/-c)、sed(s///、-i、address range)、
  awk 基本 program 跑通,對照 GNU/uutils 在本機的輸出 diff。
- 注意:awk/grep/sed 在 uutils 的完成度需先查(uutils 主打 coreutils,
  grep/sed/awk 屬 findutils/其他套件,可能要 ripgrep-wasm 或單獨專案補)。

## 比較維度(最後產出決策表)

| 維度 | Track 1 | Track 2 |
|---|---|---|
| 語意正確性 | JS regex 近似 | POSIX 真實作 |
| bundle 體積 | 小(~百 KB 級) | 大(每 binary 數百 KB~MB) |
| 與 JS/fs 整合 | 原生絲滑 | 需 WASI adapter |
| 授權 | BSD/MIT | MIT(uutils)/ GPL(busybox) |
| 工程量 | 小(alias + stub) | 中(編譯 + shim + adapter) |

預期結論方向:兩者混用 — 日常 fs 操作用 Track 1,text processing
(grep/sed/awk)用 Track 2,共用一個虛擬 fs。以 PoC 驗證後定案。

## Milestones

1. **M1 — ShellJS PoC**:Vite 專案 + alias + memfs,瀏覽器 console 跑
   `shell.ls()` / `shell.grep()` / `shell.sed()` / `shell.cat()`。(~半天)
2. **M2 — 指令存活表**:接 ShellJS 測試套件,產出各指令通過率報告。(~半天)
2.5. **M2.5 — shell 語法直譯層 PoC**:bash-parser(現成 AST parser)+
   自寫 evaluator。範圍為層 1–2:argv/quoting、$VAR 展開、glob、
   redirect(> >> < 2>)、pipe、; && ||、$(...) command substitution、
   ~ 展開、export、$?。指令本體接 M2 驗證過的 ShellJS,包成統一介面
   `(argv, stdin) → {stdout, stderr, code}` 的 builtin registry
   (此 registry 即未來 Track 2 WASM 工具的掛載點,與 M5 會合)。
   不做:control flow(層 3)、job control(層 4)。(~1 天)
3. **M3 — uutils WASM PoC**:編出 `cat`/`sort`(coreutils 內確定有的),
   在瀏覽器經 WASI shim 跑通、讀寫虛擬 fs。(~1 天)
4. **M4 — text tools 補洞**:確認 grep/sed/awk 的 WASM 來源
   (uutils 生態 / ripgrep / busybox 單抽),跑通 grep。(~1 天)
5. **M5 — fs adapter**:memfs 與 WASI shim 共用同一份檔案樹,
   兩個 track 在同一個「磁碟」上互通。(~1 天)
6. **M6 — 決策**:整理比較表,決定產品採用的組合與範圍。

## 模組化與演化路線(20260810 定案)

### 打包:兩層式(不走 Vite plugin,不綁生態系)

- **base 層**:自有程式碼(interp/builtins/worker 協定)改為 factory,
  依賴全由 ctx 注入:`bsh({ fs, shell, parse, fg })` — 概念同
  @plotdb/rescope 的 load-to-context 模式。base 本身零 import、
  bundler-agnostic,可直接給自行管理依賴的使用者。
- **bundle 層**:esbuild script(非 Vite;alias/polyfill 於打包時解掉)
  把依賴內容連同 base 包成 self-contained ESM,自帶 ctx 初始化。
  一般使用者零設定引入,任何 bundler 或 <script type=module> 皆可。
- 依賴後設資料:輸出 `bsh.pkg.dependencies = [{name, version, path}...]`
  供 rescope 類工具使用;規格化(JS 版 dependencies 定義)未來在
  rescope 端討論(已寫入該 repo TODO)。
- **不變量(重要)**:ctx 中的 `fs` 與 `shell`(shelljs)必須綁同一個
  fs 實作 — shelljs 的 fs 是它被打包當下 alias 決定的,base 無從代換;
  bundle 層保證這件事,base 層文件註明,初始化時可做 sanity check。
- worker 注意:ctx 無法跨 postMessage 傳遞,base factory 需在
  worker realm 內各自初始化(bundle 層提供 worker entry 成品)。

### shelljs 退場(路線 C,掛觸發條件不排時程)

指令分兩群,命運不同:

1. **text tools(grep/sed/awk)**:不用 JS 重寫 — M3/M4 的 WASM
   真工具(busybox/uutils)接手,POSIX 語意正確。
2. **fs 操作(ls/cp/rm/mv/mkdir/touch/chmod/ln/cat/find)與瑣碎指令
   (sort/head/tail/uniq/cd/pwd)**:值得自製 — 寫成吃注入 fs 的
   純函式(createBuiltins(fs)),估 600–1000 行,M2 存活表當驗收。

觸發條件(任一成立才動工,避免為重寫而重寫):
- 做 M3/M4 時順勢把 grep/sed 換 WASM(shelljs 依賴少一半)
- shelljs 行為問題需要修的時候(已知案例:dir-glob EISDIR)
- bundle 體積開始痛的時候

終局:自製 fs-builtins + WASM text tools + 直譯層,shelljs 與
alias 機關、execa stub 一併移除;base 的 ctx 縮為 { fs, parse }。

### 套件切分與命名(20260810 定案:@plotdb/esh)

- 定位:**shell runtime written in JS**(embeddable shell),
  瀏覽器只是旗艦宿主 — Node(真 fs 或 memfs 沙箱)/worker 皆可跑,
  Node 宿主零墊片(shelljs 的 require('fs') 天然解析)。
- 名稱 `esh` = embeddable shell。既有同名專案(jirutka 模板/google UART/
  JVM jeeshell)分屬不同領域且無強勢擁有者,JS/npm 領域空缺,不構成障礙;
  文件一律寫全名 @plotdb/esh 消歧。否決:jsh(StackBlitz 強勢同名)、
  webshell(資安攻擊術語)、shcore(Windows DLL 搜尋災難)。
- 套件:
  - `@plotdb/esh` — 主套件。exports:browser 條件 → dist/esh.js
    (self-contained bundle);default → src/node-entry.js(Node 零墊片);
    `/base`(esh(ctx) factory)、`/core`(零依賴直譯器)子路徑供進階使用
  - esh-term:~~另開套件~~ → **併入主套件、分檔出貨**(20260810 定案):
    dist/esh-term.{js,iife.js,css} + esh-worker.js,exports ./term ./worker
- API 名同套件名:`esh(ctx)`。

### async core(0.1.0,20260810 定案開工)

動機:自訂指令(0.0.2 的 registerCommand)最自然的形態是 async
(fetch/curl、IndexedDB、UI 互動如 ldcover.prompt),但 evaluator 全同步,
目前只能明確報錯。方案評估:全面 async 化 vs generator 雙驅動
(單 codebase 保 sync+async 兩 API)— 後者優雅但可讀性/改寫成本過高,
且同步 API 沒有必須保留的場景(terminal 走 worker 協定本來就 async),
定案 **core 全面 async 化**,breaking change 出 0.1.0。

- API:`sh.run()` 一律回 Promise<{stdout, stderr, code}>;
  自訂指令可回傳 Promise(await 後 normalize,reject → stderr + code 1)
- 改動範圍:
  - core.js:evalNode 鏈全 async(Pipeline/Logical/If/For/While/Until/
    Case/Command/Subshell)、callBuiltin/callFunction、wordSegments
    (CommandExpansion 遞迴 evalNode)→ expandString/expandWordToFields
    連帶 async;xargs(內部再呼叫指令)連帶;builtins 本身維持同步簽名
    (await 非 Promise 零成本), 回 Promise 亦可
  - base.js:run 轉發 Promise;sanity check 不變
  - shell.worker.js:onmessage handler await run
  - 測試矩陣:m2/m25/bundle-test/index.pug tests popup 全改 await
- 附帶紅利:exp/ 的 ask 示範可拆 SAB+Atomics+coi-sw
  (async 指令直接 await postMessage 往返;exp 端另行處理)
- 風險:漏 await(靠 m2 81 + m25 72 迴歸網抓)、效能(可忽略)

### serveShell / connectShell(0.2.0,20260810 定案開工)

動機:0802-agent 專案(browser agent runtime)要把 esh 當 runtime,
主執行緒多個消費者(chat UI / sandbox 渲染 / 檔案上傳)需要跟 worker 內
shell 互動 — 把「跨執行緒使用 shell」做成正式 API,取代每處自訂
postMessage 方言。提案與評估見 tasks/serve-connect-shell.md。

- worker 側 `serveShell(sh, target, info?)`:掛協定 handler
  (addEventListener, 不搶 onmessage);exec 沿用既有格式
  {id, type:'exec'} → {id, type:'result', stdout, stderr, code, cwd},
  新增 {id, type:'fs', op, args} 與 {type:'hello'} 握手;
  exec + fs 進同一條 promise queue;回傳 {dispose}
- 主執行緒側 `connectShell(workerOrUrl)` → Promise<{run, io, cwd, worker,
  dispose}>;hello 重試握手(晚 attach 不依賴初始 ready 廣播);
  id 帶隨機前綴(多 client 不撞號、廣播靠 id 過濾)
- fs op 白名單僅 readFile / writeFile(control-plane 走 exec;
  內容不經 shell parser;append 亦然 — read+concat+write);
  writeFile 自動建父目錄;binary:content 收 string | Uint8Array
  (structured clone 原生),readFile encoding 預設 utf8、null/'binary'
  回 Uint8Array
- base 同步補 `sh.io`(本地 promise 版 readFile/writeFile 同簽名,
  local/remote drop-in)與 `sh.cwd()`
- dogfooding:shell.worker.js 改以 esh(ctx) + serveShell 實作
  (線上協定不變),term.js client 改用 connectShell
- exports:主 entry re-export;另開 ./remote 子路徑(零依賴)

## 目前狀態

- [x] StackBlitz jsh 能力盤點(2026-08-09)
- [x] shx 在 WebContainers 內可用性驗證
- [x] M1 ShellJS PoC(24/25 通過,見 logs/20260809-m1-shelljs-poc.md)
- [x] M2 指令存活表(80/81 通過,見 logs/20260809-m2-survival-table.md)
- [x] M2.5 shell 語法直譯層(30/30 通過,見 logs/20260809-m25-shell-interp.md)
  - [x] 後補 field splitting + xargs(39/39)
- [x] M2.6 control flow 層 3 + Worker 架構 + xterm.js 終端(55/55,
  見 logs/20260809-m26-controlflow-worker-terminal.md)
- [x] OPFS 持久化 — ZenFS 換底成功(branch dev/zenfs,M2 80/81 等分、
  M2.5 55/55,/home 掛 WebAccess 實測重整存活,
  見 logs/20260810-zenfs-opfs.md);快照方案不需要了
- [x] 語法邊角全數完成(m25 72/72,見 tasks/syntax-edges.md 與 logs/20260810-syntax-edges.md)
- [x] 兩層式打包 PoC(base factory + esbuild bundle,零 bundler 8/8,
  見 logs/20260810-two-layer-bundle.md)
- [x] 定名 @plotdb/esh、esh-term 併入主套件、repo 定形、README 英文化
  (見 logs/20260810-package-shape.md;poc-shelljs 已移除)
- [x] npm publish 0.0.1(fedep publish 攤平驗證於消費端無誤)
- [x] 0.0.2 自訂指令 API registerCommand(per-shell + 全域;c5f5298)
- [x] 0.1.0 async core(m2 80/81 等分、m25 72/72、bundle-test 9/9 含 async
  測項、Node 16/16;worker exec 序列化;exp/ 驗證 async ask 指令
  — SAB/Atomics/coi-sw 橋確認可拆)
- [x] 0.2.0 serveShell / connectShell(exec+fs+hello 協定、sh.io/sh.cwd、
  dogfooding worker+term、test/remote.mjs 17/17;評估與定案見
  tasks/serve-connect-shell.md)
- [x] 0.3.0 git command pack(isomorphic-git;ctx.esh 介面、./git entry、
  test/git.mjs 20/20、OPFS 實機含 symlink roundtrip;
  見 tasks/git-support/)
- [x] 0.4.0 scoped root(chroot)+ device backend(wagent 需求;
  bindContext + withFsScope 圍堵、DeviceFS 子類 live-stat;
  另修 OPFS 覆寫不截斷 bug — 見 tasks/ 對應檔)
- [x] 0.4.1 esh-term tab 補全(`__complete` builtin + term.js Tab;
  單候選直補/公共前綴/雙擊列清單;實機驗證 cat 直補、README.md 路徑補全、
  echo/env/export 清單;cmd-edges +7 測項)
- [ ] zenfs-issue-fire:向 zenfs 上游回報 Async mixin 的 isInLoop 缺陷
  (追加:WebAccess.write 從不截斷 — opfs-overwrite-no-truncate, 一併回報)
  (stack 字串比對判斷 replay, bundle/瀏覽器環境不可靠 → replay 誤 echo
  過期 metadata 回 sync 鏡像, async backend 上 sync 寫入靜默失真;
  根因分析與最小重現見 tasks/opfs-sync-write-loss.md。esh 已在
  fs-zen-shim hardenAsyncMounts() 自行修補 — 0.3.2, 上游修了即可移除)
- [ ] M3 WASM PoC(依 plan 上方評估:優先 busybox,uutils 為 fallback)
- [ ] backlog(peer review 0.1.0 發現, pre-existing 非回歸):
  (1) break 丟出時 CompoundList 當輪已累積 stdout 被丟棄
  (`for i in a b c; do echo $i; break; done` stdout 空);
  (2) evalCommand 暫時性賦值(VAR=x cmd)restore 不在 finally,
  Break/ReturnSig 穿過時不還原 — 修時順手搬進 finally

## 參考

- ShellJS: https://github.com/shelljs/shelljs
- memfs: https://github.com/streamich/memfs
- ZenFS: https://github.com/zen-fs/core
- uutils coreutils: https://github.com/uutils/coreutils
- browser_wasi_shim: https://github.com/bjorn3/browser_wasi_shim
- isomorphic-git: https://isomorphic-git.org
- 全機模擬備案(若上述路線語意缺口太大): v86(BSD)、container2wasm(Apache-2.0)
