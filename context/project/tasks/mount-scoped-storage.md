# mount 短名字吃選項 — 同一個 origin 上並存多份互不干擾的 workspace

回報者:wagent(新 repo `/Users/tkirby/workspace/plotdb/projects/wagent`),esh **0.5.0**。

功能請求,不是 bug。現在的行為完全符合它自己的註解,我們要的是多一個選項。

## 現況

`src/bundle-entry.js` 的 `mountAll()`:

    if(m.backend === "opfs")
      return navigator.storage.getDirectory().then((handle) => {
        spec[k] = { backend: WebAccess, handle };      // <- 永遠是 origin 的 root
      });
    if(m.backend === "indexeddb") { spec[k] = { backend: IndexedDB }; return; }
                                                       // <- storeName 沒得傳

兩個短名字都不吃選項,所以同一個 origin 上的每個頁面拿到的都是**同一份**儲存。

## 為什麼我們需要它

wagent 的 repo 現在有三個 sample 頁面(single-block / multiple-blocks / dataviz),
全在同一個 origin。結果是 dataviz 的 block 清單會看到另外兩個 sample 留下的 block ——
demo 裡看起來像 bug,而它確實也是我們無法表達的東西。

我們一開始以為這是 OPFS 的限制(一個 origin 一份),實測不是 —— 子目錄隔離得很乾淨:

    const root = await navigator.storage.getDirectory();
    const a = await root.getDirectoryHandle('__iso_a', {create: true});
    const b = await root.getDirectoryHandle('__iso_b', {create: true});
    // 各寫一個同名 x.txt -> readA "in A", readB "in B", 互不干擾

也就是說能力本來就在,只是短名字沒把它開出來。

**為什麼不能由我們自己塞 backend 設定。** `mountAll()` 最後有 `spec[k] = m`
(「進階:直接給 zenfs backend 設定」),但那條路我們走不到:wagent 的 mounts 要跨
`postMessage` 進 worker(以 JSON URL 參數傳),而 zenfs 的 `isBackend()` 要求物件帶
`create` 函式 —— **字串不會被解析成 backend**。所以任何可序列化的表達方式,都只能
經過短名字表。這也是為什麼我們認為這個選項該在 esh 這邊,而不是各家應用自己想辦法。

## 希望的樣子

    { "/home": { backend: "opfs", path: "dataviz" } }
    // -> getDirectory() 之後 getDirectoryHandle(path, { create: true }) 再交給 WebAccess
    //    省略 path = 現在的行為 (origin root), 不是 breaking

    { "/home": { backend: "indexeddb", storeName: "dataviz" } }
    // -> { backend: IndexedDB, storeName }
    //    zenfs 的 IndexedDBOptions 本來就有這個欄位, 註解也明說
    //    「You can have multiple IndexedDB file systems operating at once,
    //      but each must have a different name」
    //    省略 = 現在的行為

兩個都維持**可 JSON 序列化**,這點對我們是硬條件(要過 postMessage)。

`path` 想支援多層(`"a/b"`)的話對我們有加分但不必要;真要支援請注意
`getDirectoryHandle` 不吃斜線,得自己逐段建。

## 驗收我們會做的事

同一個 origin 開兩個頁面,各自 `{backend: "opfs", path: "x"}` / `path: "y"`,
兩邊都在 `/home/workspace` 底下建同名的檔案,互相看不到;重新整理後各自的內容還在。
indexeddb 同一套。

## 附帶一提

這件事對我們還有第二個用途:sample 頁面想「乾淨啟動」時可以給一個一次性的 path,
不必去清使用者的 OPFS。現在只能用 `{backend: "memory"}`,但那樣就沒有持久化,
測不到重載後的行為。


## 實作(20260827;進 0.5.1)

照需求的形狀落地,`bundle-entry.js` 的 mountAll:

 - `{backend: "opfs", path: "dataviz"}`:getDirectory() 後逐段
   `getDirectoryHandle(seg, {create: true})` 再交給 WebAccess —
   **多層 path("a/b")直接支援**(split 後 reduce, 不經斜線)。
   省略 path = origin root, 原行為不變。
 - `{backend: "indexeddb", storeName: "dataviz"}`:直傳 zenfs
   IndexedDBOptions。省略 = 原行為。

瀏覽器實測(你們驗收清單那套):同 origin 兩個 opfs path 各寫同名
`x.txt` 互看不到、`ls` 只見自己的;多層 path 可用;兩個 storeName 的
indexeddb 各自獨立;**重載後各自內容都在**;省略 path 的 opfs 仍看得到
origin root 全部(含子目錄)— 非 breaking 確認。既有測試套件 127 項全過。
