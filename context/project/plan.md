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
- [ ] M3 uutils WASM PoC

## 參考

- ShellJS: https://github.com/shelljs/shelljs
- memfs: https://github.com/streamich/memfs
- ZenFS: https://github.com/zen-fs/core
- uutils coreutils: https://github.com/uutils/coreutils
- browser_wasi_shim: https://github.com/bjorn3/browser_wasi_shim
- isomorphic-git: https://isomorphic-git.org
- 全機模擬備案(若上述路線語意缺口太大): v86(BSD)、container2wasm(Apache-2.0)
