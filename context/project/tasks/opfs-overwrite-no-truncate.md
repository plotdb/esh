# OPFS: 覆寫較短內容時沒有截斷, 舊內容的尾巴留在檔案裡

回報者: wagent (0802-agent), esh 0.3.2

## 症狀

用較短的內容覆寫一個既有檔案後:

 - **同一個 session 內讀回來是對的** (readFile / cat 都回新內容)
 - **重新整理頁面後**, 檔案變成「新內容 + 舊內容多出來的尾巴」

也就是說 OPFS 上的檔案從來沒有被截斷, 只是被前面覆蓋掉一段;
記憶體鏡像蓋住了這件事, 所以在 session 內完全看不出來。

## 最小重現

```js
const long  = 'A'.repeat(200);
const short = 'B'.repeat(20);

await sh.io.writeFile('probe.txt', long);
await sh.io.writeFile('probe.txt', short);

await sh.io.readFile('probe.txt');        // 20  ← 正確
(await sh.run('cat probe.txt')).stdout;   // 20  ← 正確

// --- 重新整理頁面 (重新掛載同一個 OPFS) ---

await sh.io.readFile('probe.txt');
// 200: 'BBBBBBBBBBBBBBBBBBBB' + 'A'.repeat(180)
```

mount: `{'/home': {backend: 'opfs'}}`, 路徑在 `/home/workspace/` 下。

## 影響

對 agent 這個用途來說相當嚴重, 因為「把檔案改短」是最常見的編輯之一
(刪掉一段程式、把 pretty-print 的 json 改成單行、精簡 html)。

 - 寫完當下所有檢查都會過 — agent 讀回來是對的, 畫面也是對的
 - 使用者重新整理之後, block 變成「新內容 + 一段舊程式碼的殘骸」而壞掉
 - 因為錯誤延遲到下一次載入才出現, 現場幾乎不可能歸因到寫檔

我這邊實際踩到的樣子: 一個 `block.json` 被改短後, 重新整理變成
`{...}` 後面接著上一版的殘句, `JSON.parse` 直接爆掉。

## 猜測

寫入時取 writable / sync access handle 後直接從 offset 0 寫, 沒有:

 - `createWritable()` 預設會截斷, 但若用了 `{keepExistingData: true}` 就不會
 - `FileSystemSyncAccessHandle` 則需要顯式 `truncate(size)`

同步路徑 (`createSyncAccessHandle`) 少一個 `truncate` 最像。
順帶一提: 上一個 bug (0.3.2 修掉的 replay 誤判) 也是「記憶體鏡像正確、
OPFS 實際內容不正確」這個形狀, 也許值得一併檢查寫入路徑上還有沒有
其他「只寫不截斷 / 只寫不同步」的地方。

## 根因與修正(20260813;0.4.0 出貨)

猜測正確:zenfs WebAccess.write 用 `createWritable({keepExistingData: true})`
從 offset 覆寫,**整條路徑上沒有任何人截斷真檔** — 不管 sync replay 或
直接 async 寫都一樣。鏡像(與 index)size 正確,所以 session 內讀不出來。

修正:hardenAsyncMounts(0.3.2 加的 replay 修補)的方法重掛上,
`touch` 帶 `size` 時(vnode sync 的 pre-truncate 與收尾 touch 都會帶)
檢查真檔長度,較長就以 `createWritable({keepExistingData:true})` +
`truncate(size)` 補一刀。io(async)與 shell redirect 兩路徑實測:
寫短後直讀 OPFS 原生 API(繞過 zenfs)皆無殘留。

## 建議的驗收

除了上面的重現, 值得補一個 round-trip 測試:對同一個檔案寫入一串長度
遞減的內容, 每次寫完都**重新掛載**再讀, 確認長度與內容都完全相符。
只在 session 內讀是驗不出來的 — 這正是這個 bug 藏了這麼久的原因。
