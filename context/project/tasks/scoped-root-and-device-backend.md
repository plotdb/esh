# scoped root(chroot)與 device backend

來自 0802-agent(wagent — browser agent runtime)的需求提案,請評估。
兩件事寫在一起,因為它們服務同一個目標:**讓 host 用 mount table 決定 agent 看得到什麼**。


## 背景

wagent 把 agent 當成「操作 host 的人」:host 開什麼窗口,agent 就能做什麼。
目前 agent 看到的是整個 `/home/workspace`(`blocks/*` + `data/`),
於是有兩個問題:

1. 編輯單一元件時,agent 看得到、也改得到別的元件。而且因為它看得到整棵樹,
   host 得從寫入路徑反推「它在動哪個元件」——這個反推最近才因為猜錯被拆掉。
2. 應用自己的文件狀態(協作試算表、node tree)完全不在 fs 裡,agent 對它全盲。
   目前只能由 host 每輪推一段摘要進 prompt,agent 無法自己 query。

兩者都指向同一個解法:**讓 mount table 決定範圍與內容**。


## 需求 A — scoped root(chroot)

### 目的

「編輯這個元件」時,agent 的 fs 就只有那個元件的目錄。
路徑從 `blocks/foo/index.html` 變成 `index.html`,prompt 不必再解釋目錄慣例,
agent 也不可能誤改別人。

### 關鍵要求:必須是真的限制,不能只是路徑前綴

我們自己可以在 tool 層把路徑加前綴,但那不算數 —— `run_shell` 裡
`cd ..`、絕對路徑、`find /`、glob 都能走出去。要有效必須由 shell/fs 這層保證。

### 建議 API(僅供參考,設計以你們為準)

    createShell({mounts, root: '/home/workspace/blocks/foo'})
    sh.chroot('/home/workspace/blocks/bar')   // 切換編輯對象

比「執行期 remount」更合適的理由:

 - 不必動 zenfs 的 `configure()`(那是全域的,重掛風險大)
 - **同一份 fs 可以有兩個 shell、各自不同 root** —— 這正好解掉下面那個開放問題

需要涵蓋:`cd ..` 不得超出 root、絕對路徑以 root 為 `/`、
glob / `find` / `ls` 不得列出 root 以外、`..` 正規化後再檢查(避免 `a/../../..`)。

### 開放問題:終端機要不要一起被限縮

wagent 目前 agent 與使用者的終端機**共用同一個 `sh`**(esh-term 經 `connectShell`
連到同一個 worker),這個「人與 agent 操作同一份 working tree」的性質很好用,
不想失去。

但範圍限縮之後,兩者需求可能不同:agent 應該被關在元件目錄裡,
使用者可能仍想在整棵樹裡逛。

若 root 是 **per-shell** 而非 per-mount,這題就自然解了:
同一份 fs 上開兩個 shell(agent 一個、終端機一個),root 不同、資料同一份。
所以我們傾向 per-shell,但如果你們覺得 per-mount 更合理也可以討論。


## 需求 B — device backend(callback-backed 檔案)

### 目的

讓應用把「不是檔案的東西」以檔案形式交給 agent。例:

 - `/dev/sheet` — 讀它 = 讀當下協作試算表的內容。
   agent 就能用**它已經會用的工具**去 query:`grep`、`wc -l`、`head`、`cut`
 - 之後也可能是編輯器緩衝區、目前選取的節點等

這比「再開一個 LLM tool」好:tool 清單維持短,而 shell 本來就可組合、可自我說明。

注意:**哪些東西是 device、哪些是一般檔案,由應用決定**,esh 只需要提供機制。
以 makechart 為例,`/index.html` 會是**一般檔案**(那是我們要存下來的程式文本),
而 sheet 是 device(它另外存進 db)。

### 範圍:先只做整檔 read / write

不需要 append、seek、部分寫入、streaming。更複雜的情境我們會另外開專用 tool
處理(對照現在的做法:內容一律走 read_file / write_file tool,不走 shell 重導向)。

`read(path, buffer, start, end)` 這種帶區間的介面,由 device 取得完整內容後切片即可。

### 建議 API

    createShell({
      mounts: {
        '/home': {backend: 'opfs'},
        '/dev': {backend: 'device', files: {
          sheet: {
            read:  function() { return currentSheetAsCSV(); },   // 同步, 回 string / Uint8Array
            write: function(content) { applySheet(content); }    // 省略 = read-only
          }
        }}
      }
    })

`readdir` 回 `files` 的 key 即可。靜態表先夠用;動態清單(`list()`)可之後再說。

### 關鍵設計約束(這段最重要)

**1. sync-authoritative,不要走 Async mixin,不要維護鏡像。**

device 的整個重點是「值是活的」。套上記憶體鏡像之後,鏡像必然會與真值分岔。

這不是理論顧慮 —— 這個 repo 最近修的兩個 bug
(`opfs-sync-write-loss`、`opfs-overwrite-no-truncate`)**形狀完全一樣**:
記憶體鏡像是對的、實際內容是錯的,所以 session 內怎麼測都正常。
device 再套一層鏡像等於主動製造同一類 bug,而且更難發現(真值每秒都在變)。

**2. `statSync` 的 size 必須當場算。**

`readFileSync` 是照 stat 回報的 size 配置 buffer 的 —— `opfs-sync-write-loss`
讀出全空白就是走這條路徑。device 若回快取的 size,讀出來會被截斷或補零,
而且**看起來完全正常**(有內容、長度合理、不拋錯)。

**3. 可宣告 read-only。**

寫回去往往是有損的(CSV 反解成結構化文件會掉型別、格式、公式)。
唯讀的那半就已經很有價值,不該被「必須支援寫入」拖住。
device 沒有 `write` 時,寫入應該回明確的錯誤(EROFS 之類),而不是靜默成功。

### 不需要的東西

**變更通知不用做。** device 的 callback 本來就是應用自己的程式碼,
應用比誰都早知道自己的 sheet 變了,不需要 esh 幫忙回頭通知。


## 未定 / 想聽你們意見

 - **非同步的 device**(內容來自 sharedb 這類)。zenfs 的 `disableAsyncCache`
   看起來是相關開關,但關掉之後 sync 讀就沒了,而 shell 的很多路徑是 sync 的。
   目前我們可以接受「device 必須能同步物化」這個限制,但想知道你們怎麼看。
 - **樂觀鎖語意**。wagent 的 `edit_file` 是「讀 → 比對 → 寫」,
   檔案被外部改過就拒絕並要求重讀。但 device 的內容本來就會在腳下變
   (使用者正在打字),對 device 而言那是常態而非錯誤。
   這大概是我們這邊要處理的,但如果 fs 層有辦法表達「這是 volatile 的」會更好。


## 實作定案(20260813,esh 側;0.4.0 出貨)

兩需求皆照提案方向實作,API 與提案一致:

 - **A**:`createShell({root})` + `sh.chroot(p)`(host 端 JS API, shell 指令
   呼叫不到, agent 穿不出去)。採 per-shell root(提案傾向的方案)。
   圍堵機制:zenfs `bindContext`(路徑先對可見 root 正規化、`..` 在 /
   夾住, 再 join ctx.root)+ shelljs/fg 同步指令以 defaultContext 暫換
   (withFsScope)括住 — 同步區間單執行緒不可交錯, 無 TOCTOU。
   io / 自訂指令 / git pack 走 bound fs, 同樣受限。
 - **B**:繼承 zenfs DeviceFS(char device — vnode 對 char device
   bypassCache, 天然滿足約束 1 無鏡像);stat/statSync 覆寫為每次物化
   取 size(約束 2);無 write callback → EROFS(約束 3)。
   偵測 rooted shell 中 device 可見性:把 device 掛在 root 內路徑即可
   (mount point 任意, host 決定)。

未定項的回覆:

 - **非同步 device**:維持「device 必須能同步物化」。shell 的 sync 讀
   (readFileSync 依 stat size)天生要同步真值;在 sync 路徑等待 async
   來源只能 spin(我們在 debug OPFS bug 時實際把 renderer 卡死過一次,
   就是這個形狀)。sharedb 類來源的正解是 host 端維護同步快照
   (sharedb 本地 doc 本來就同步可讀), read() 回快照。
   `disableAsyncCache` 不適用(它是關掉 sync 支援, 不是讓 sync 等 async)。
 - **volatile 語意**:不另加 API — char device 的 mode(S_IFCHR,
   `stat.mode & 0xF000 === 0x2000`)本身就是可偵測的 volatile 標記,
   edit_file 的樂觀鎖可據此改判(跳過 mtime/內容比對或改 last-writer-wins)。

驗收結果(20260813 瀏覽器實機):下方清單全數通過,含 rooted+device
組合(device 掛 root 內, agent 讀活值)與 io 圍堵(rooted shell 的
io.readFile 對 root 外路徑 ENOENT)。

## 驗收建議

scoped root:

 - `cd ..` / `cd /` / 絕對路徑 / `find /` / `ls ../..` 都不得看到 root 以外
 - `a/../../../etc` 這種正規化後越界的路徑要擋
 - 同一份 fs 上兩個不同 root 的 shell,互相看得到對方寫的東西(在各自可見範圍內)

device:

 - `cat /dev/sheet` 兩次之間改變真值 → 第二次讀到新值(**不得**讀到第一次的快取)
 - 真值長度變化後 `wc -c /dev/sheet` 與 `cat` 的長度一致(stat 沒有走快取)
 - read-only device 被寫入時回明確錯誤
 - `grep` / `head` / `cut` 對 device 檔案可正常運作
