# dev-notes — 開發環境操作備忘

工具鏈的坑, 續作前必讀。細節出處見 logs/。

## 兩套打包並存, alias 表有兩份

- `tools/build.mjs`(esbuild, 出貨)與 `vite.config.mjs`(測試頁 dev)
  各有一份 alias 表, **改 shim 時兩邊都要看**;未來可抽共用 JSON。
- esbuild 的 alias 需同時鋪 `fs` 與 `node:fs` 兩種 specifier。
- esbuild 需 `define: { global: "globalThis" }`(events 依賴引用裸 global,
  vite 時代由 polyfill plugin 默默處理)。

## vite 的雷

- **改 shim 檔後必須 `rm -rf node_modules/.vite` 重啟**,否則 shim 被
  inline 在 deps cache 裡, 改動無效(看起來像修了沒用)。
- prebundle 出的 zenfs fs 物件 getter-only, 不能就地 monkeypatch
  (Node 端可以, 本機測試會騙人)— 修補要做在 Object.assign 複本上。
- worker 是獨立 pipeline:`worker: { plugins: () => [nodePolyfills(...)] }`
  要另掛(alias 共用, plugin 不繼承)。

## 瀏覽器自動化(Claude in Chrome)

- extension 的合成鍵盤事件進不了 xterm 的 helper textarea(真人鍵盤正常);
  自動化測終端改用 JS dispatch InputEvent/KeyboardEvent。
- 分頁若 screenshot「Script injection timed out」, 先開新分頁再判斷 —
  可能只是舊分頁 extension 卡住, 不是頁面死圈(曾誤診一小時)。

## 慣例與環境

- `npm start` = fedev template server(tkirby 慣例);`npm run dev` = vite。
  port:vite 5199 / template server 8080(-o true 會自開瀏覽器)。
- context/shared → ~/.context/@plotdb/guides/src, 與
  ~/workspace/plotdb/projects/guides 是同一份(改了直接生效,
  但要去 guides repo commit+push)。
- `@zbryikt/template` 版本是 ^2.4.2(裝 ^6 會 ETARGET)。
- dist/ 與 web/static/assets/esh/ 不進 git;publish 前要先 npm run build。

## 直譯器開發

- 迴歸網:m2(81)+ m25(72), 動 core/shim 必跑;m25 支援
  ?from=N&to=M 切片 bisect。
- 不碰 fs 的語法 case 可直接在 Node 跑 core 快速 debug
  (`node --input-type=module` + import interp), 比開瀏覽器快。
- 所有 fs 存取一律走 alias 的 'fs' import, 禁止直接 import memfs/zenfs
  (曾因 interp 直接 import memfs 導致換底後 redirect 全爛)。
