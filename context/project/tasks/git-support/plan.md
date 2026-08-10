# Plan: optional git support(isomorphic-git command pack)

spike 結論見 finding.md(isomorphic-git 直接吃 ZenFS 為 fs backend 可行,
不需改 isomorphic-git core)。本 plan 為 review 修訂版(20260810):
修正原版兩個對照 esh 現況的錯誤(自訂指令 ctx 沒有 fs/shell;argv 不含
指令名),補上 author/config、OPFS symlink、worker 邊界三個缺口。

## 目標與分層

core 保持輕量,git 為 opt-in command pack:

- **core tier**(既有):shell runtime + builtins,不 import isomorphic-git
- **command pack tier**:`@plotdb/esh/git` 子路徑,增 bundle 體積者住這層
- **workflow tier**:srckit 等消費者自行決定裝不裝、或再包 domain 指令

## 前置 core 改動:自訂指令 ctx 補 esh 介面

現況:自訂指令收到的 ctx 是 interpreter state(vars/funcs/commands/
positional/scopes/lastCode),**沒有 fs 也沒有 shell** — 任何想碰檔案的
自訂指令(不只 git)都拿不到 fs。改法:

- `createContext()` 產出的 state 掛 `ctx.esh = { fs, cwd }`
  (fs 即 initDeps 注入的 fs;cwd = () => String(shell.pwd()));
  由 base.js 在 esh(ctx) 時填入(core 維持零 import 不變量)
- 對既有指令零影響;文件補進 features.md 自訂指令節

此改動讓 `createShell({commands: gitCommands()})` 這條路成立
(不然 gitCommands() 拿不到 fs, 只有 installGit(sh) closure 一條路)。

## API

```js
import { gitCommands, installGit } from "@plotdb/esh/git";

// 建構時掛
const sh = await createShell({ mounts: {...}, commands: gitCommands(opts) });

// 或事後掛
installGit(sh, opts);   // = sh.registerCommand(gitCommands(opts))
```

- 一律 per-shell(不用全域 registerCommand — 不跨 shell 汙染)
- `opts.author = { name, email }`:commit 的 fallback author(見下)
- 指令內取 fs/cwd:優先 `ctx.esh`(core 改動後);installGit 版同樣走
  ctx.esh(單一路徑, 不維護兩套)

## 指令簽名與 argv(修正)

esh 傳給指令的 argv **不含指令名**(callBuiltin 已 slice):

```js
async function gitCommand(argv, stdin, ctx) {
  const sub = argv[0], args = argv.slice(1);   // ✔ 不是 argv[1]
  const fs = ctx.esh.fs;
  const dir = await git.findRoot({ fs, filepath: ctx.esh.cwd() })
    .catch(() => ctx.esh.cwd());   // init 前沒有 root — fallback cwd
  ...
}
```

- `dir` 用 `git.findRoot`(repo 子目錄下指令才不會壞;`git init` 例外用 cwd)
- 回傳走 esh 寬鬆慣例:字串 = stdout;錯誤 `{stderr, code}`

## 第一版指令集(local only)

- `git init`
- `git status`(statusMatrix 轉 porcelain 風格輸出)
- `git add <path...>`(支援 `.`;glob 由 shell 展開, 指令端收多個 path)
- `git commit -m <message>`(author 解析順序:repo config → opts.author →
  報錯提示 `git config user.name ...`)
- `git config user.name [value]` / `git config user.email [value]`
  (isomorphic-git set/getConfig, 寫 repo 的 .git/config;**必須進第一版**,
  否則 commit 在乾淨環境不可用)
- `git log`(`--oneline` 可選, depth 上限預設 50)
- `git branch` / `git branch <name>`
- `git checkout <ref>`

**Defer**(network:另案設計 HTTP transport/CORS/auth/URL policy):
clone / fetch / pull / push。

## Packaging

```json
"exports": {
  "./git": { "browser": "./dist/esh-git.js", "default": "./src/git-command.js" }
}
```

- 比照主 entry 的 browser/default 條件 — isomorphic-git 在 Node 原生可跑,
  Node 宿主不吃 browser bundle(fedep 1.7.5+ 已支援 conditional exports
  的 publish 攤平)
- `dist/esh-git.js` 只 bundle isomorphic-git(fs 執行期注入, 不重複打包
  zenfs);tools/build.mjs 加一個 entry
- isomorphic-git 放 `dependencies`(bundle 隔離靠 entry, install 體積可接受)

## Worker / esh-term 邊界(第一版明文限制)

function 過不了 postMessage — git pack 只能裝在「自己 createShell 的
那一側」。故:

- 本地 shell / 自組 worker(如 0802-agent):installGit 直接用 ✔
- esh-term 預設 worker(dist/esh-worker.js):第一版**不含** git;
  之後若要,選項是 (a) 烤進 esh-worker(bundle +~百KB 級, 所有終端用戶
  埋單)或 (b) serveShell 加可選 pack 機制 — 待有實際需求再決定
- 文件與 README 明講此邊界, srckit 接的時候不會意外

## Tests

- `test/git.mjs`(Node, 零瀏覽器):memfs/zenfs shell → installGit →
  init → io.writeFile → add → commit(含無 config 報錯、config 後成功)
  → status(clean/dirty)→ log → branch → checkout 切換驗檔案內容
- bundle 檢查:`grep -c isomorphic dist/esh.js` 必須為 0(主 entry 不得
  混入;防未來誤 import)
- 瀏覽器/OPFS 驗證(Node 穩定後):重點驗 **symlink** — spike 只驗了
  InMemory;OPFS(WebAccess)原生無 symlink 概念,zenfs 是否模擬/持久化
  需實測。含 symlink 的 checkout 是真實場景;若不支援, 文件列為已知限制
- statusMatrix racy-stat(finding 所述):每次指令 fresh cache +
  文件註明;不採 isomorphic-git cache 參數(與 racy-stat 交互不明,
  列後續優化)

## Milestones

1. [x] core ctx.esh 改動 + features.md 補記
2. [x] src/git-command.js:init/config/add/commit/status + test/git.mjs
   + check-bundle
3. [x] log/branch/checkout + 測試補齊(20 案例)
4. [x] build entry + exports;瀏覽器/OPFS 驗證(20260810 實測):
   - symlink:zenfs 於 WebAccess 上可建立(mode 120000),commit →
     切分支 → 切回 roundtrip 正確 — **非 blocker**
   - 但剛寫入的檔案(尤其 symlink)可能晚一 tick 才被 statusMatrix
     看到(WebAccess flush 時序);已列 CHANGELOG 已知注意
   - checkout 以 commit oid(detached HEAD)不支援 — isomorphic-git
     會誤導地 fallback 找 origin/<ref>,已攔下給明確錯誤
5. [ ] 版本 0.3.0 出貨(README 待補);network 指令另開 task
