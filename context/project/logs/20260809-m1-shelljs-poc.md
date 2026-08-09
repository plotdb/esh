# 20260809 — M1: ShellJS + memfs 瀏覽器 PoC

## 結果

成功。24/25 測項通過(poc-shelljs/, `npx vite --port 5199` 後開 http://localhost:5199)。
ls/cat/cd(相對路徑)/grep/sed(-i 寫回)/sort/head/tail/mkdir/cp -r/mv/rm -rf/
touch/chmod/ln -s/echo().to()/find/uniq/test 全部正常運作於 memfs 上。

## 架構

- Vite + vite-plugin-node-polyfills(path/buffer/stream/os/util 等)
- alias:`fs` → src/fs-shim.js(→ memfs)、`execa` → stub、
  `process` 與 `vite-plugin-node-polyfills/shims/process` → src/process-shim.js(自製完整版)
- PoC 用 Vite 而非 pug/lsc template stack:bundler alias 本身就是本實驗的核心機制

## 踩到的雷(重要, M2+ 會再遇到)

1. **fast-glob 依賴 `process.versions.node`**:@nodelib/fs.scandir 在 import 時
   `process.versions.node.split('.')`,polyfill 的 process 沒這欄位 → 整包炸掉。
2. **process shim 會被 rolldown 內嵌進 deps chunk**:在 source 端 patch 自己 import
   的 shim instance 沒用(chunk 裡是另一份 copy)。正解:直接 alias 掉
   `vite-plugin-node-polyfills/shims/process` 換成自製 process(src/process-shim.js,
   含 cwd/chdir 可變狀態、versions、env、stdout.write→console)。改 alias 後要
   `rm -rf node_modules/.vite` 重新 prebundle。
3. **shelljs 0.10 依賴 execa**(exec 用)→ 必須 alias stub,否則 esbuild 解析
   child_process 就失敗。
4. **ShellJS sed API 不是 sed 表達式**:`sed(/regex/, "replacement", file)`,
   不是 `sed("s/x/y/", file)` — 寫測試時搞錯過。
5. **ShellJS grep 不會跳過 glob 展開出的目錄**:`grep -l pat src/*` 若 glob 中有
   目錄 → EISDIR exception(GNU grep 會警告後繼續)。做 shell 前端時 glob 展開
   要先 filter 掉目錄,或包一層 try。

## 已知不支援

- `shell.exec()` — 無 child_process,stub 為明確 throw。

## 下一步

- M2:接 ShellJS 官方測試套件產生完整指令存活表
- M3:uutils/busybox WASM PoC(優先 busybox,見 plan.md)
