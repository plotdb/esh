# 20260810 — 定名 @plotdb/esh、esh-term、repo 定形

(接 two-layer-bundle 之後的整段套件化工作)

## 命名

- 定案 `@plotdb/esh`(embeddable shell)。決策細節與否決名單
  (jsh/webshell/shcore 等)見 plan「套件切分與命名」。
- API `bsh(ctx)` → `esh(ctx)`;定位語:a shell runtime written in JS,
  瀏覽器只是旗艦宿主。

## 多宿主

- src/node-entry.js:Node 零墊片(shelljs require('fs') 天然解析),
  實測 pipe/算術正常。exports 按宿主分流(browser/default)。
- 非 ESM:iife build 掛 window.esh / window.eshTerm(fedev/lsc 生態必需)。

## esh-term(決策:併入主套件, 分檔出貨, 不另開 package)

- src/term.js:createTerminal(el, opts) — vite 頁與 bundle 共用;
  worker 可自備(vite 靜態分析形式)或由同目錄 esh-worker.js 自動解析
  (iife 以 document.currentScript 定位, ESM 以 import.meta.url)。
- dist 增 esh-term.{js,iife.js,css} + esh-worker.js(含完整引擎)。
- web demo(index.pug, lsc):終端全螢幕 + tests popup dialog(5/5);
  OPFS 持久化於 template server 實測(bundle-worker-42 重整存活)。

## repo 定形

- esh/ 結構(bundle-spec)→ 拉至 repo 根目錄;package.json/CHANGELOG
  與根合併;vite 測試頁 → web/vitedev/(明確標示 vite 專用,
  維持 plain html 不 pug 化 — 工具鏈不相容且為凍結鷹架)。
- poc-shelljs/ 移除(git history 保留完整演進)。
- README 改英文, 依 shared/4.md-style-guide 格式(四格縮排 code block)。
- npm scripts:dev:web → start(tkirby 慣例)。
- guides repo:狀態子資料夾(done/hold/drop)與年份歸檔規則通用化,
  已 commit+push(abc01b4)。

## 發佈前 checklist(未做)

- npm run build(dist 不進 git)→ npm publish --access public
- 確認 @plotdb org 權限;version 0.0.1
