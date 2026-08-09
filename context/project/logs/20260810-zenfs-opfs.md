# 20260810 — ZenFS 換底 + OPFS 持久化(branch dev/zenfs)

## 結果:成功,memfs → ZenFS 完全等分,OPFS 持久化實測通過

- M2 存活表:80/81(與 memfs 版同分,唯一失敗仍是預期的 which)
- M2.5 直譯器:55/55
- terminal.html:/home 掛 OPFS(WebAccess backend),
  `echo x > keep.txt` → 重新整理 → `cat keep.txt` 內容還在 ✔

## 架構

- src/fs-zen-shim.js 取代 fs-shim.js(vite alias 一行切換,
  memfs shim 保留可隨時 rollback)
- worker 掛載:`configure({ mounts: { "/home": { backend: WebAccess,
  handle: await navigator.storage.getDirectory() } } })`,
  /tmp 留預設 InMemory;首次使用(README 不存在)才 seed
- **sync-over-async 不是問題**:ZenFS 對 OPFS backend 的同步 API
  (readFileSync 等)直接可用,ShellJS 全同步呼叫無需改動

## ZenFS(2.6.2)與 Node fs 的行為差異(皆已在 shim 修補)

1. **相對路徑不理 process.cwd()**:ZenFS 用自己的 context cwd
   (defaultContext.pwd)。修補:process-shim 的 chdir 透過
   globalThis.__syncFsCwd hook 同步過去。
2. **readdir 回插入順序**(memfs 排序)→ shim 包一層排序。
3. **symlinkSync 不接受 type=null**(Node 接受;shelljs ln -s 傳 null)
   → shim 轉為省略參數。
4. **目錄 chmod 丟 EISDIR**(POSIX 允許)→ shim 靜默跳過目錄,
   檔案照常。已知妥協:chmod -R 下目錄本身的 mode 不變。

## 踩雷備忘

- **瀏覽器 prebundle 的 zenfs fs 物件是 getter-only**,不能就地
  monkeypatch(Node 端可以,所以本機測試會騙人)→ 修補要做在複本上
  (Object.assign({}, fs, patches))。
- **fs shim 被 inline 進 vite deps cache**:改 shim 後必須
  rm -rf node_modules/.vite 重啟,否則改動無效(看起來像修了沒用)。
- interp.js 原本直接 import memfs 讀 redirect 檔案 — 換底後讀到空 fs,
  `< file` 全爛。教訓:所有 fs 存取一律走 alias 的 'fs',
  不要直接 import 具體實作(已抽 src/seed.js 統一)。

## 結論

fs 層現在是可插拔的:InMemory(測試)/ OPFS(持久)/ 未來 IndexedDB
或 zip mount 都是 configure 一行的事。快照方案不需要了。
