# Change Logs

## v0.4.1

 - bugfixes(wagent 回報, 見 tasks/redirect-immediate-read-race.md):
   - redirect 寫入與先前 sync 寫入的 replay 佇列 race — 直接 async 寫
     (promises.writeFile)會超車稍早 sync 寫(io.writeFile / sed -i)的
     replay, 再被晚到的 replay 蓋回舊值(實測 io 長寫→redirect 短寫
     32/60 失敗;回報的「寫後立即讀到空」為同機制的側影)。
     修正:fs-zen-shim 新增 drainFsReplays()(追平所有 async mount 的
     replay 佇列尾), writeRedirect 寫入前先排空。
     修正後同場景 0/60、原重現 0/30、sed 交錯 0/30, 磁碟落地正確
 - features:
   - esh-term tab 補全:第一個 token(含 `|` `&&` `;` 之後)補指令
     (builtins + 自訂指令 + shell functions),其餘補路徑(目錄加 /);
     單候選直補、多候選補公共前綴、同一行連按兩次列清單。
     候選經既有 exec 協定問 worker 的 `__complete` builtin
     (`cmd <prefix>` / `path <dir> <prefix>`, 隱藏名不入候選) —
     協定無變動;rooted shell 走同一 ctx, 列不出 root 外。
     v1 限制:不處理含空白/引號的檔名、不補 flag

## v0.4.0

 - features(wagent 需求, 見 tasks/scoped-root-and-device-backend.md):
   - **scoped root(chroot)**:`createShell({root})` / `sh.chroot(p)` —
     per-shell root, shell 指令與 io 全被關在 root 內("/" 即 root)。
     圍堵在 fs 層保證:zenfs 路徑解析先對可見 root 正規化再 join(ctx.root),
     `..` 在 / 夾住、絕對路徑一律 re-root;shelljs/fast-glob 這類綁全域 fs
     的同步指令以 withFsScope 括住(同步區間單執行緒, 不與他 shell 交錯),
     core 自身與自訂指令走 bindContext 的 bound fs。同一份 fs 可多個 shell
     各自不同 root(agent 限縮、終端不限), 互見彼此寫入。
     chroot 為 host 端 JS API, shell 指令內呼叫不到。僅瀏覽器 bundle 支援
     (Node 宿主給 root 會明確報錯)
   - **device backend**:`{backend: 'device', files: {name: {read, write?}}}` —
     callback-backed 檔案(char device)。sync-authoritative 無鏡像無快取
     (vnode 對 char device bypassCache);stat size 每次當場物化;
     無 write → EROFS 明確報錯;範圍為整檔 read/write(offset 0)。
     rooted shell 要看 device, 把 device 掛在 root 內的路徑即可
 - bugfixes:
   - **OPFS 覆寫較短內容不截斷**(tasks/opfs-overwrite-no-truncate.md):
     WebAccess.write 用 createWritable({keepExistingData}) 從不截斷,
     舊尾巴留在磁碟、鏡像蓋住看不見、重載才爆。hardenAsyncMounts 的
     touch wrapper 在 metadata 帶 size 且真檔較長時補 truncate —
     io 與 shell redirect 兩路徑實測磁碟直讀皆無殘留

## v0.3.2

 - bugfixes(資料遺失, wagent 回報 — 見 tasks/opfs-sync-write-loss.md):
   - **根因**:zenfs Async mixin 以 stack 字串比對(isInLoop)判斷 async
     replay,bundle 後格式不符 → 每個 replay 被誤判為新呼叫,把過期
     metadata(pre-truncate 的 size 0)echo 回 sync 鏡像;readFileSync 依
     stat size 配 buffer → 讀到空字串 → sed -i 等 read-modify-write 把
     檔案清空,`>` 冷寫入讀回 0 bytes,全程 exit code 0
   - fs-zen-shim `hardenAsyncMounts()`:把 zenfs 的 stack 偵測換成明確的
     reentrancy flag(行為同 zenfs 原意:replay 不 echo、直接 async 呼叫
     照樣進鏡像);並等所有 mount ready()(關掉掛載初始化期間
     sync 讀不到剛寫入內容的窗口)。bundle-entry 與 shell.worker 掛載後呼叫
   - redirect(`>`/`>>`)改走 async 寫入(promises.writeFile/appendFile)
     + 回讀驗證,失敗回 stderr + code 1(不再靜默);`> /dev/null` 特例丟棄;
     寫入不存在目錄現在會報錯(先前 shelljs silent 模式下無聲失敗)
   - fs-zen-shim writeFileSync 寫後以 statSync 驗 size,不符丟 EIO —
     shelljs 內部寫入(sed -i 等)失真時至少出聲
 - tweaks(wagent 使用端回報):
   - sed 支援 `;` 串接多重運算式(s/a/b/;s/c/d/;s/// 內的 `;` 為字面值);
     解析失敗整段報錯, 不再靜默套用第一段
   - grep 補 `-c`(計數)與 `-q`(安靜);無符合時 exit code 1(POSIX 語意,
     先前一律 0);shelljs 的空訊息 "grep: " no-match 錯誤正規化為乾淨的
     code 1
 - tests:test/write-verify.mjs(含說謊 fs 模擬失真)、test/cmd-edges.mjs
   (sed 多段/grep -c -q/read-after-write);瀏覽器實機全矩陣
   (冷/熱 sed -i、0〜500ms 延遲掃描、append、掛載後立即寫入)

## v0.3.1

 - tweaks:
   - 裸打 `git` / `git help` 印 usage(支援 subcommand 清單 + local-only
     說明, code 0)— 原本回「缺少 subcommand」易誤判為指令不存在

## v0.3.0

 - bugfixes:
   - 瀏覽器端 `cd <不存在目錄>` 誤回成功且 pwd 被改壞 — process-shim 的
     chdir 從不驗證(shelljs cd 靠 node chdir 丟 ENOENT 判錯)。
     現由 fs shim 掛 `__eshValidateCwd` hook 驗證目標存在且為目錄
     (ENOENT/ENOTDIR 語意同 node);Node 宿主本來就正確, 不受影響
 - features:
   - optional git command pack `@plotdb/esh/git`(isomorphic-git):
     `createShell({commands: gitCommands(opts)})` 或 `installGit(sh, opts)`,
     per-shell 註冊。第一版 local only:init / config(user.name、user.email,
     commit author 必要)/ add(含 `.`、刪除 stage、子目錄相對路徑 findRoot)/
     status(porcelain 風格)/ commit -m / log(--oneline、-n)/ branch /
     checkout(branch/tag;oid detached HEAD 未支援, 明確報錯)。
     network 指令(clone/fetch/pull/push)另案
   - core:自訂指令 ctx 新增 `ctx.esh = {fs, cwd}`(base.js 注入,
     subshell 繼承)— 自訂指令自此可碰檔案, git pack 依賴此介面
   - exports 新增 `./git`(browser → dist/esh-git.js;Node 直跑 src)
   - build:dist/esh-git.{js,iife.js};check-bundle 檢查主 entry
     不混入 isomorphic-git(進 npm test)
 - 驗證:test/git.mjs 20 案例(Node)+ 瀏覽器 OPFS 實機
   (含 symlink commit/branch 切換 roundtrip, mode 120000 正確)
 - 已知注意:OPFS(WebAccess)剛寫入的檔案(尤其 symlink)可能延遲一個
   tick 才被 statusMatrix 看到;statusMatrix racy-stat(同秒同大小改寫)
   為 isomorphic-git 既有行為, 見 tasks/git-support/finding.md

## v0.2.0

 - features:
   - serveShell(sh, target, info?) / connectShell(workerOrUrl):跨執行緒使用
     shell 的標準協定(exec 線上格式沿用 0.1.0 worker, 既有用戶無感;
     新增 {type:'fs'} 內容傳輸 op 與 {type:'hello'} 握手)。
     transport-agnostic:target 只需 postMessage + addEventListener 形狀
   - fs op 白名單僅 readFile / writeFile(control-plane 走 exec,
     data-plane 內容不經 shell parser);writeFile 自動建父目錄;
     binary:content 收 string | Uint8Array, readFile encoding 預設 utf8、
     null/'binary' 回 Uint8Array;exec + fs 同一條 promise queue 序列化
   - 多 client 支援:connectShell id 帶隨機前綴(不撞號、廣播靠 id 過濾),
     hello 重試握手(serveShell 晚掛 — 如 OPFS 掛載中 — 亦可連上)
   - base:sh.io(本地 promise 版 readFile/writeFile, 與 remote 同簽名,
     消費端 local/remote drop-in)、sh.cwd()
   - exports 新增 ./remote(零依賴);主 entry re-export
 - dogfooding:shell.worker.js 改以 esh(ctx) + serveShell 實作;
   term.js client 改用 connectShell(addEventListener 掛,
   不搶 onmessage — 同一 worker 可並存使用方自己的協定)
 - tests:test/remote.mjs(loopback 假 target,17 案例:晚掛握手/
   多 client/並存/序列化/binary/dispose)

## v0.1.0

 - breaking:
   - evaluator 全面 async 化: `sh.run()` 一律回 Promise<{stdout, stderr, code}>
     (worker 協定不變, esh-term 使用者無感;直接呼叫 run 的要改 await)
 - features:
   - 自訂指令可為 async function / 回傳 Promise(reject → stderr + code 1);
     pipe / $( ) / redirect / xargs / 迴圈與條件全路徑支援
   - shell.worker: exec 以 promise chain 序列化, 多個 exec 不交錯共享狀態
   - base: 同一 shell 的並發 run 亦序列化(promise chain, 錯誤不斷鏈,
     各呼叫回自己的結果)— sync 時代不可能重入, async 化後的新暴露面

## v0.0.2

 - bugfixes:
   - 自訂指令回傳 Promise 時明確報錯(evaluator 為同步;先前會靜默回報成功)
   - normalizeCmdResult 強制 stdout/stderr 轉字串、code 轉數字
     (非字串 stdout 曾使下游 pipe 炸 s.replace is not a function)
   - Subshell 修復: sub context 先前缺 funcs/commands/positional/scopes,
     `(echo hi)` 直接 TypeError;現 vars 複本隔離、其餘共用 reference
 - features:
   - 自訂指令 API: sh.registerCommand(name, fn) / ({name: fn, ...}),
     createShell({commands}) 建構時掛一批;簽名同 builtin
     (argv, stdin, ctx) → {stdout, stderr, code}, 寬鬆回傳(字串視為 stdout)
   - per-shell registry(ctx.commands)為主;另有全域 registerCommand
     (跨 shell 共用, 從 entry re-export, 慎用)
   - 查找順序: shell function → per-shell → 全域 → builtins

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
