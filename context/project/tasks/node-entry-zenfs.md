# node entry 走 zenfs — mounts / chroot / device 在 Node 也能用

回報者:wagent (0802-agent),esh **0.4.2**。

先說結論:**這是功能請求,不是 bug。** 現在的 node entry 行為完全符合它自己的註解
(「零墊片:Node 裡 shelljs 的 `require('fs')` 天然解析到真 fs」),我們要的是**另一種**
node 宿主 —— 走 zenfs 的那種。兩者用途不同,我認為應該並存。


## 現況

`src/node-entry.js`:

    export function createShell(opts) {
      return Promise.resolve(esh({
        fs: (opts && opts.fs) || fs,      // <- opts.mounts 被忽略
        shell, parse, fg,
        commands: opts && opts.commands
      }));
    }

於是 0.4.0 之後加的三樣東西在 Node 全部拿不到:

| | 瀏覽器 bundle | node entry |
|---|---|---|
| `mounts` / 換 backend | ✅ | ❌ 直接綁真 fs,參數被忽略 |
| `root` / `chroot` | ✅ | ❌ `base.js:32` 明說「需 zenfs scope hooks — 瀏覽器 bundle 限定」 |
| `device` backend | ✅ | ❌ 它是 `bundle-entry.js` 註冊的 |


## 為什麼我們需要它

wagent 的 host 契約第一塊就是 mounts,設計上寫著「同一份 host 定義前後端通用,
差別只在 mount table」。我們現在要讓同一套 runtime 在 Node 上也能跑
(CI、批次、排程 —— 沒有使用者分頁的場合),才發現**那句話的 node 那半從來沒成立過**。

具體卡住的三件事,對我們都不是可有可無:

 - **`chroot`** —— agent 的圍堵。我們用 `sh` / `shAgent` 兩個 shell 共用同一份 fs:
   使用者的終端機看得到整棵樹,agent 關在 workspace 內。Node 沒有 chroot 就等於
   agent 對整台機器的檔案系統有 shell —— 這在伺服器上跑是不能接受的。
 - **`device`** —— 應用層的文件狀態(試算表之類)以唯讀檔案給 agent 查。
   沒有它,agent 在 Node 側看不到任何非檔案的應用資料。
 - **`mounts`** —— 決定資料存哪。Node 側我們要的是真磁碟的某個子目錄,
   而不是整個 `/`。


## 需求

`createShell({mounts, root, commands})` 在 Node 與瀏覽器**行為一致**。

backend 短名字希望多一個 passthrough(zenfs 2.6.2 在 Node 有 `Passthrough` /
`PassthroughFS`,我確認過 export 存在):

    createShell({
      mounts: {'/home': {backend: 'passthrough', path: '/srv/workspaces/u123'}},
      root: '/home/workspace'
    })

語意就是「把真磁碟的這個目錄掛進虛擬 fs 的這個位置」,對應瀏覽器的
`{backend: 'opfs'}`。有了它,wagent 兩側就真的只差一張 mount table。

其餘短名字(`memory` / `device` / 以及「其他就原封不動傳給 zenfs」那條 fallback)
希望與 `bundle-entry.js:42-49` 完全一致 —— 我們的應用層會直接把同一個 mounts 物件
餵給兩邊,不想寫兩套。


## 難點(我看到的,你們比我清楚)

`base.js` 開頭那條不變量:

> ctx.fs 與 ctx.shell 內部綁定的 fs 必須是同一個實作 —
> shelljs 的 fs 在其打包當下已定案,base 無從代換,僅能驗證。

瀏覽器是用 vite 的 `resolve.alias` 把 `fs` 換成 `fs-zen-shim.js` 解掉的
(`vite.config.mjs`)。Node 直接 `import shell from "shelljs"` 就繞不過去,
`esh()` 裡那個 sanity check 會抓到(或更糟:不同世界但檢查剛好沒踩到)。

我想得到的路,由高到低:

1. **出一個 node 目標的 bundle**,套用同一組 alias(`fs` → `fs-zen-shim`,
   以及 execa / process / os 那幾個)。這條的好處是**沿用已經驗證過的機制** ——
   瀏覽器那份就是這樣過來的,不必發明新東西。`exports` 加一個入口,
   例如 `"./node-zenfs"`,或讓 `default` 條件指向它、原本的零墊片版改成
   明確的 `"./node-fs"`。
2. Node 的 module loader hook 攔 `require('fs')`。不建議 —— 全域副作用,
   跟同 process 的其他程式碼打架。
3. 讓 shelljs 可注入 fs。上游改動,不現實。

我猜是 1,但要注意 `tools/build.mjs` 目前應該只產瀏覽器目標,以及
`nodePolyfills` 在 node 目標下多半要關掉(那些模組是真的存在的)。


## 相容性

現有的 `createShell()`(不帶 mounts)行為請務必別動 —— 直接操作本機真實檔案的能力
是它現在的用途,而且註解裡已經警告過了。我們要的是**多一個**宿主,不是換掉它。

如果 `exports` 的 `default` 要改指向 zenfs 版,那算 breaking;如果新增
`"./node-zenfs"` 子路徑則不是。這個由你們決定,我們兩種都能接。


## 我這邊的用法(供參考)

    // 瀏覽器 (現在就是這樣跑的)
    createShell({mounts: {'/home': {backend: 'opfs'},
                          '/home/workspace/dev': {backend: 'device', files: {...}}}})
    createShell({root: '/home/workspace'})        // agent 專用, 同一份 fs

    // Node (希望能這樣)
    createShell({mounts: {'/home': {backend: 'passthrough', path: WORKDIR},
                          '/home/workspace/dev': {backend: 'device', files: {...}}}})
    createShell({root: '/home/workspace'})

兩段除了 backend 那一行以外完全相同 —— 那就是我們要的。


## 不急

wagent 這側還有事情要做(headless renderer),沒有這個不會卡住我們現在的進度,
只是 Node 那條路要等它。想先知道你們覺得可不可行、以及大概是哪個方向,
我們好決定要不要在應用層先寫死瀏覽器。


## 可行性評估(20260826,esh 側)

**可行,方向就是你猜的 1(node 目標 bundle),而且比瀏覽器那條乾淨。** 已實測關鍵點:

 - `Passthrough` 在 zenfs 2.6.2 確認可用且**全同步**:
   `configure({mounts: {'/mnt': {backend: Passthrough, fs: nodeFs, prefix: dir}}})`
   之後 readFileSync / writeFileSync / mkdirSync / readdirSync / statSync 直通真磁碟,全過。
 - 全同步意味著 WebAccess 那三個 async 資料遺失 bug(isInLoop replay echo、
   寫短不截斷、redirect race)在這條路**結構上不存在**,`hardenAsyncMounts` 不需介入。
 - `fs-zen-shim.js` 只依賴 `@zenfs/core`,無瀏覽器 API,Node 直接可用;
   process-shim / os-shim 零 import。打包機制沿用 `tools/build.mjs` 的 esbuild alias,
   差異只在 `platform: "node"`、path/stream 等不換 browserify、不 import `@zenfs/dom`。

實作要點(給未來開工用):

 1. 新 entry `src/node-zenfs-entry.js`:抄 `bundle-entry.js`,backend 短名字表
    `memory` / `device` / fallback 原樣,`opfs`/`indexeddb` 改報錯提示,
    新增 `passthrough` → `{backend: Passthrough, fs: <真 fs>, prefix: m.path}`。
 2. 「真 fs」取得:bundle 內 `fs` 已被 alias 成 shim,真 fs 用
    `process.getBuiltinModule('fs')`(runtime 取用,bundler 不會攔)。
 3. `tools/build.mjs` 加 node 目標:`platform: "node"`,alias 只留
    fs/process/os/execa/child_process 幾個 shim,zenfs 必須打進 bundle
    (與 shim 同一實例);沿用 global-inject 讓 bare `process` 走 shim
    (shelljs 的 `process.cwd()` 必須看到虛擬 cwd,這是 chroot 成立的前提之一)。
 4. `exports` 加 `"./node-zenfs"` 指向 dist 產物;`"."` 原樣不動 — 非 breaking。
 5. 測試:async-core / cmd-edges / write-verify 對新 entry 重跑一輪 +
    chroot escape checklist + passthrough 專屬(真磁碟回讀對照)。

**一個必須誠實講的安全 caveat**:chroot 圍堵發生在 zenfs 路徑解析層,
但 passthrough 底下是真磁碟 — **真磁碟上的 symlink 由真 fs 解析**,
指向 prefix 外的既有 symlink(或 agent 用 `ln -s` 造的)可能穿出圍堵。
開工時必測;緩解選項:rooted shell 禁 `ln -s`、prefix 目錄保證無外指 symlink、
或看 zenfs Passthrough 有無 no-follow 選項。在此之前,伺服器上請把
prefix 目錄當作「agent 可完整讀寫」的邊界來配置(例如專用空目錄)。

工作量粗估:entry + build target + exports 半天內,測試(含 escape checklist
與 symlink 實測)再半天。是否排入、排哪個版本,由 tkirby 決定。


## 實作結果(20260826;0.5.0)

照評估的方向 1 落地,全數需求達成 + symlink 圍堵直接做掉(不只文件警告):

 - `src/node-zenfs-entry.js` + `tools/build.mjs` node 目標(platform:node,
   fs/process/os/execa/child_process 走 shim、path 用 path-browserify 保 posix、
   createRequire banner 解 CJS 依賴的 builtin require)→ `dist/esh-node.js`,
   exports `"./node-zenfs"`。`.` 原樣不動。
 - backend 短名字與 bundle-entry 對齊:`memory` / `device` / fallback 相同;
   `passthrough` → `{backend: "passthrough", path: dir}`;`opfs`/`indexeddb`
   在 Node 給明確錯誤訊息(指向 passthrough)。同一份 mounts 物件餵兩邊成立。
 - **symlink 穿透實測確認後直接堵掉**(`src/fs-guard.js`, 預設開):
   交給 Passthrough 的真 fs 包一層 realpath containment — jail 內既有
   symlink 指外讀寫一律 EACCES、斷 symlink 指外的寫入拒(防外部建檔)、
   shell 內 `ln -s /外部` 建立時即擋;`followSymlinks: true` 可關。
   附帶發現:zenfs 經 passthrough 建的 symlink 不是真 symlink,
   agent 自造 symlink 本來就穿不出去 — 威脅只剩既有磁碟 symlink, 現已涵蓋。
 - **順手抓到兩隻 zenfs 上游 bug**(已進 plan.md zenfs-issue-fire 清單):
   1. Passthrough 上 `appendFile`(sync/promises)把檔案**清空**、
      `{flag:"a"}` 被當覆寫 → esh 的 `>>` 改 read+concat+write
      (run 佇列序列化下語意等價), 回讀驗證一併涵蓋 append。
   2. PassthroughFS.touch/touchSync 把 undefined 的 metadata.mode 餵
      chmod → 寫**既有**檔案時 close→sync→touch 必炸, zenfs 卡 stale
      (disk 有內容、cat 回空)→ entry 內 prototype patch(值是數字才動)。
 - process-shim 改為不覆蓋已存在的 `globalThis.process`(宿主 app 安全);
   真 fs 以 `process.getBuiltinModule` 取得(需 node ≥ 20.16)。
 - 測試:`test/node-zenfs.mjs` 26/26(passthrough 雙向可見、symlink guard
   五態、chroot escape checklist(cd ../絕對路徑/組合路徑/glob/io)、
   device live 值 + EROFS + bare head 迴歸、memory、mount 設定錯誤);
   既有五套 94 測項全過;瀏覽器迴歸 async-test 7/7、bundle-test 10/10、
   OPFS+memory `>>` 實測正常(core 的 append 改動不影響瀏覽器)。

**wagent 驗收(20260827;0.5.0 發布後)**:實際組合(root + passthrough +
device 掛 root 內)寫成他們的 test/node-esh.mjs 21 項全過 — chroot 爬不出去、
passthrough 雙向即時可見、`>>` 不清空、readdir/stat 形狀正確、device 即時值
且不落磁碟、symlink 內外兩向都擋住。兩個初始 FAIL 均為對方測試自身筆誤
(基準檔漏換行;掛載點目錄會建出、改斷言「存在但為空」),非 esh bug。
他們的 file tree 已從 `ls -R`+解析 stdout 換成遞迴 readdir(瀏覽器實測過,
空目錄誤判檔案的舊問題順帶消失)。

使用(wagent 的兩段式寫法成立):

    import { createShell } from "@plotdb/esh/node-zenfs";
    const sh = await createShell({ mounts: {
      "/home": { backend: "passthrough", path: "/srv/ws/u123" },
      "/home/workspace/dev": { backend: "device", files: {...} }
    } });
    const agent = await createShell({ root: "/home/workspace" }); // 同一份 fs
