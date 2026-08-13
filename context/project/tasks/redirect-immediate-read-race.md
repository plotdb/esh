# 0.4.0 回歸:shell redirect 寫入後「立即」回讀會讀到空的

回報者:wagent (0802-agent),esh **0.4.0**,`/home` 掛 OPFS。

先說結論:**你們修的 truncate 是對的、確實修好了**(驗收在最後一節)。
但 redirect 路徑上出現一個新的時間窗。


## 症狀

`echo ... > file` 之後**立刻**讀同一個檔,有機率讀到空字串。
不是內容遺失 —— 等一下再讀就是對的。

    await sh.run('echo HELLOWORLD > f.txt');
    (await sh.run('cat f.txt')).stdout;     // 有機率是 ""
    // 等 20ms 之後再讀 -> "HELLOWORLD\n"


## 延遲掃描(每格 6 次)

| 寫入後延遲 | 失敗次數 |
|---|---|
| 0ms   | **3 / 6** |
| 5ms   | **1 / 6** |
| 20ms  | 0 / 6 |
| 50ms  | 0 / 6 |
| 200ms | 0 / 6 |

**這正好是 0.3.2 那個 bug 的鏡像** —— 當時是「距上次寫入 ≥20ms 才壞」,
現在是「<20ms 才壞」。時間常數一樣是 ~20ms,懷疑是同一段機制的另一側。


## 路徑範圍(每格 8 次)

| 路徑 | 結果 |
|---|---|
| `io.writeFile` → 立即 `io.readFile` | 0 / 8 失敗 ✅ |
| **`echo > f` → 立即讀** | **7 / 8 失敗** ❌ |
| `sed -i` → 立即 `cat` | 0 / 8 失敗 ✅ |

只有 **shell redirect** 受影響。`io` 與 `sed -i` 都乾淨。

因為非確定性,單跑一次可能剛好過 —— 我第一次試 `echo hello > p3.txt` 就是通過的,
連跑才穩定重現。建議驗收時跑 N 次而不是一次。


## 影響

對我們是中等:content ops 走 `io`(安全),而且 prompt 本來就教 agent
不要用 shell redirect 寫內容。但 `run_shell` 仍開放給 agent,它偶爾會用 `>`,
而失敗形式是**靜默讀到空**,不是錯誤 —— 這種「看起來成功但內容是空的」
正是最難追的那類。


## 猜測

truncate 的補刀若發生在寫入之後(先 truncate 再寫、或 touch(size) 後才落內容),
就會有一段「檔案已被截斷、新內容還沒寫進去」的窗;此時的讀取拿到 0 bytes。
`io` 路徑沒事,可能是因為它的寫入與 size 更新在同一個同步區間內完成。


## 驗收(0.4.0 實機,我這邊)

**已修好的:**

 - `opfs-overwrite-no-truncate`:寫 200 bytes → 寫 20 bytes → **重新整理** →
   讀回 20 bytes、內容乾淨(`B{20}`,無殘留)✅
 - `rm -rf` 有落地:刪掉一個 block 目錄後重新整理,確實不見 ✅
   (先前看到「刪掉的 block 復活」是 0.3.2 時代刪的殘留,不是 0.4.0 的問題)
 - 我們 `write_file` / `edit_file` 先 unlink 的繞法已經拆掉,回歸正常 ✅

**新問題:** 上面那個 redirect race。


## 根因與修正(20260814,esh 側;0.4.1 出貨)

方向猜對了一半 — 不是 truncate 補刀的窗, 是**兩條寫入路徑的佇列 race**:

 - sync 寫入(io.writeFile / sed -i / shelljs 內部)= 先進記憶體鏡像,
   真 backend 的落地排進 zenfs 的 replay 佇列(_promise 鏈), 晚幾 ms 執行
 - redirect 是直接 async 寫(promises.writeFile), **不經佇列** —
   會超車稍早 sync 寫的 replay;更糟的是那筆 replay 之後才到,
   把 redirect 剛寫的內容**蓋回舊值**

實測放大鏡(比回報的更嚴重的形狀):io 長寫 → 立即 redirect 短寫,
32/60 失敗 — redirect 內容整筆丟失(0.3.2 的寫入驗證讓它出聲 code 1,
但寫入確實沒了)。回報的「寫後立即讀到空」是同機制在你們環境的側影
(佇列時序不同)。esh-term 純 redirect+cat 在乾淨環境不觸發 —
需要背景有 sync 寫入活動, 這解釋了為何非確定性。

修正:fs-zen-shim `drainFsReplays()` — 追平所有 async mount 的 replay
佇列尾(含等待期間新進的, 有上限防呆);writeRedirect 寫入前先排空。
曾嘗試「把直接 async 寫也排進同一條佇列」的做法, 會干擾 zenfs vfs
內部時序(vnode 鎖/鏡像假設), 已否決。

驗證:io→redirect ×60、純 redirect 立即讀 ×30、sed 交錯 ×30 全數 0 失敗,
磁碟落地正確;0.3.2/0.4.0 全部既有場景(trial 掃描/冷 sed/truncate)無迴歸。
