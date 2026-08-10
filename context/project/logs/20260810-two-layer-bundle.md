# 20260810 — 兩層式打包 PoC(base factory + esbuild bundle)

## 結果:成功

- **bundle-test.html 8/8**:單檔 dist/browser-shell.js(self-contained ESM)
  在純 python http.server 上零 bundler 直接 import 使用 —
  pipe/算術 while/function/xargs/redirect 全部正常
- 既有 vite 環境無退化:m25 72/72、terminal(OPFS)照舊
- 體積:未壓縮 1.7MB / minify 788KB / gzip 226KB

## 架構(對應 plan「模組化與演化路線」)

- **src/core.js**:interp 全文改零 import — 依賴以模組級變數 +
  `initDeps({parse, shell, fs, fg})` 注入(單實例限制,文件註明)。
- **src/interp.js**:降為相容層 — vite alias 解依賴後 initDeps,
  再 re-export createContext/run;m25/worker 等舊 import 介面不變。
- **src/base.js**:`bsh(ctx)` factory — 檢查依賴齊全 +
  fs/shell 同世界 sanity check(寫檔互驗),回傳 {run, context, fs}。
- **src/bundle-entry.js**:bundle 層 — `createShell({mounts})` 支援
  opfs/indexeddb/memory 掛載捷徑;`bsh.pkg.dependencies` 後設資料。
- **scripts/build.mjs**:esbuild-only(不碰 vite),alias 表 +
  global-inject(Buffer/process)一次解掉。新增 child_process-shim
  (先前由 vite polyfill plugin 默默補的)。

## 備忘

- esbuild alias 需同時鋪 `fs` 與 `node:fs` 兩種 specifier。
- 真正需要的 polyfill 比 vite include 清單短:path/buffer/events/
  stream/util/assert + 三個自製 shim;stream/events 是 fast-glob
  async 路徑連坐拉進來的死碼,未來甩 shelljs/fast-glob 時可再瘦。
- vite 這邊 interp.js 相容層照舊走 alias — 兩套打包並存,
  vite 只剩開發測試頁用途。
