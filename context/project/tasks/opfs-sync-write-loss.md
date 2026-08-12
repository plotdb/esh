# Bug: OPFS backend 上 shell 的同步寫入會靜默清空檔案

回報者:wagent(`/Users/tkirby/ai/2026/0802-agent`,esh 的使用端)。
esh 版本:0.2.0(dist,瀏覽器 + OPFS)。0.3.1 未測,但這條路徑近期沒動過,推測仍在。

**影響:資料遺失,而且無聲** — exit code 0、stderr 空,檔案內容全沒了只剩 0 bytes。
我們是在追一個「block 檔莫名變空」時挖到的,實際弄丟過使用者的檔案。


## 症狀

檔案在**上一次寫入之後超過約 20ms**,再用 shell 做任何同步寫入(`>` 重導向、`sed -i`),
檔案就會變成 0 bytes:

    await io.writeFile('/home/ws/x.txt', 'OLD'.repeat(200));   // 600 bytes
    await sleep(500);
    await sh.run('echo NEW > /home/ws/x.txt');                 // code 0, stderr 空
    await io.readFile('/home/ws/x.txt');                       // -> '' (0 bytes)

同一段程式把 `sleep(500)` 拿掉就完全正常。


## 已縮到的範圍

| 情況 | 結果 |
|---|---|
| `echo NEW > f`(冷,≥20ms) | **0 bytes** |
| `sed -i 's/a/b/' f`(冷) | **0 bytes** |
| 同上但寫入後立刻執行(0〜10ms) | 正常 |
| `cat f` / `grep` / `cp f g`(冷) | 正常 — **同步讀沒問題** |
| `sh.io.writeFile()`(非同步寫,冷) | 正常 |
| 記憶體 backend(`createShell()` 無 mounts) | 正常 |

延遲門檻(OPFS,每次都先寫 600 bytes 再等 N ms 然後 `echo NEW > f`,看最終長度):

    0ms → 4    1ms → 4    5ms → 4    10ms → 4
    20ms → 0   50ms → 0   100ms → 0

也就是大約 10〜20ms 之間翻掉,像是某個 cache / flush 的視窗。

推測:同步寫入路徑先 truncate 再寫,而寫入那段在 OPFS backend 上沒有真的落地 —
剛寫過的檔案因為還在記憶體中所以看起來正常,冷掉之後就只剩 truncate 生效。
同步讀正常,所以問題應該只在寫入側。
(我們這邊只到 esh 的公開介面,沒有往 zenfs 內部追;有可能是 zenfs 的 sync write 對
WebAccess/OPFS backend 的問題,而不是 esh 本身。)


## 重現(瀏覽器,`/home` 掛 opfs)

    const sh = await esh.createShell({mounts: {'/home': {backend: 'opfs'}}});
    async function trial(wait) {
      await sh.io.writeFile('/home/t.txt', 'OLD'.repeat(200));
      await new Promise(r => setTimeout(r, wait));
      const w = await sh.run('echo NEW > /home/t.txt');
      return {wait, code: w.code, len: (await sh.io.readFile('/home/t.txt')).length};
    }
    for(const w of [0, 10, 20, 100]) { console.log(await trial(w)); }
    // {wait:0,code:0,len:4} ... {wait:20,code:0,len:0} {wait:100,code:0,len:0}


## 為什麼這對使用端很致命

wagent 的 agent 用 `read_file` / `write_file` / `edit_file`(走 `sh.io.*`,非同步)所以安全,
但**終端裡的人**用的是 shell,一個 `sed -i` 或 `>` 就會把檔案清掉,而且沒有任何錯誤訊息。
我們是同一份 working tree 人機共用,所以這條路一定會被走到。

退一步說,即使不修根因,**至少要讓它出聲**:寫入失敗就回非 0 exit code 與 stderr,
不要 truncate 完就當作成功。無聲的資料遺失比報錯難處理太多。


## 可能的處理方向(僅供參考,實際請你評估)

 - 同步寫入改成「先寫暫存檔再 rename」,失敗時原檔完整保留
 - 或在 OPFS backend 上把 shell 的寫入路徑導到非同步實作(反正 `sh.run` 本來就是 async)
 - 或找出 zenfs 那層 sync write 沒落地的原因(可能要在 zenfs 開 issue)
 - 無論如何:寫入未落地要能偵測到並回報錯誤,不要靜默成功


## 根因與修正(20260813,esh 側;0.3.2 出貨)

**根因在 zenfs 的 Async mixin**(@zenfs/core dist/mixins/async.js),
esh 的 dist bundle 觸發了它的環境敏感缺陷:

1. async backend(OPFS/WebAccess)的 sync 寫入 = 寫入 InMemory 鏡像 +
   排 async replay 到真 backend。zenfs 用 `_patchAsync` 把 async 方法包一層:
   完成後把參數 echo 進鏡像(讓直接的 async 呼叫也同步鏡像),
   並以 **stack 字串比對**(`isInLoop`,找 `at <computed> [as write]` 之類)
   判斷該呼叫是否為 replay(是就不 echo)。
2. bundle 後(且 Chrome stack 格式帶 class 名)比對永遠不中 → **每個
   replay 都被誤判為新呼叫**,把過期參數 echo 回鏡像。sync writeFileSync
   的三段式(pre-truncate {size:0} → write → touch {size:n})replay 時,
   `{size: 0}` 的 echo 把鏡像 inode size 歸零。
3. `readFileSync` 依 stat size 配 buffer — size 0 就回空字串(資料其實還在)。
   於是:`sed -i` 讀到空 → 寫回空(檔案真的沒了);`>` 冷寫入後讀回 0 bytes;
   全程 code 0。10〜20ms 門檻 = replay echo 相對於下一次讀的時序。
   實際資料在部分情境下仍在 OPFS 磁碟上(鏡像層失真),但被空內容
   覆寫過就真的沒了。

修正(esh 層,zenfs 未動):

 - `hardenAsyncMounts()`(fs-zen-shim):replay 偵測換成明確的 reentrancy
   flag(包 `_async` queue 設旗標;重掛 async 方法 — replay 不 echo,
   直接 async 呼叫照原意進鏡像)。掛載後由 bundle-entry / shell.worker 呼叫,
   並等所有 mount `ready()`(關掉初始化期間的鏡像空窗)
 - redirect(`>`/`>>`)改 async 寫 + 回讀驗證,失敗 → stderr + code 1
 - fs-zen-shim writeFileSync 寫後驗 size,不符丟 EIO(sed -i 失真會出聲)

驗證:瀏覽器實機 0〜500ms 全延遲掃描、冷/熱 sed -i、append、掛載後立即
寫入全過;Node 側 test/write-verify.mjs 以說謊 fs 模擬失真確認會報錯。
建議另向 zenfs 回報 isInLoop 的問題(stack 比對在 bundle/瀏覽器環境不可靠)。
