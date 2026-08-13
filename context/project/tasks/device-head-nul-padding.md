# 0.4.1:不帶參數的 `head` 讀 device 檔案會補 64KB 的 NUL

回報者:wagent (0802-agent),esh **0.4.1**。

先說:redirect race 的修正**驗證通過** —— 你們的 io→redirect ×30、
原始重現 ×30、sed 交錯 ×20,我這邊全數 0 失敗。device 與 rooted root 也接上了。


## 症狀

device 檔案內容 51 bytes,`head`(**不帶 `-n`**)回 **65587** bytes:

    cat  dev/sheet   -> 51 bytes              ✅
    head dev/sheet   -> 65587 bytes           ❌

65587 的組成很明確:

    51 bytes 內容  +  65485 個 NUL (charCode 0)  +  51 bytes 內容
    └────────── 51 + 65485 = 65536 = 64KB 整 ──────────┘

看起來是:讀取用 64KB 緩衝區,device 只填了 51 bytes,**剩下的 NUL 沒有依實際
讀取長度裁掉**就直接輸出;然後又讀了一次,把內容再輸出一遍。

一般檔案沒有這個問題(同樣內容的 `n.csv`,`head` 回 6 bytes 正常),所以是 device 專屬。


## 範圍

| 指令 | device | 一般檔案 |
|---|---|---|
| `cat` | ✅ | ✅ |
| `head -n 2` | ✅ | ✅ |
| `tail -n 2` | ✅ | ✅ |
| `tail`(不帶參數) | ✅ | ✅ |
| **`head`(不帶參數)** | ❌ 64KB NUL | ✅ |
| `grep` / `grep -c` | ✅ | ✅ |
| `wc -c` / `wc -l` | ✅ | ✅ |
| `sort` | ✅ | ✅ |
| `cat dev/sheet \| head -n 2` | ✅ | — |

只有「不帶參數的 `head`」中招。`head -n N` 正常,所以繞法是永遠帶 `-n`。


## 為什麼想修

這正是 device 的主要使用情境:agent 拿到一個「檔案」,第一個動作往往就是
`head` 看一眼長什麼樣。而失敗形式是**輸出看起來有內容**(前 51 bytes 是對的),
後面跟著一大片不可見字元 —— 塞進 LLM 的 context 是 65KB 的垃圾,
模型還可能把 NUL 當成資料的一部分去解讀。


## 順帶兩個小東西

 - `sed -n 1p dev/sheet` 回空字串(一般檔案未測,可能是 `sed -n` 的 `p` 沒支援,
   不確定是不是 device 相關,只是一併提一下)
 - `help` 指令不存在(`help: command not found`)。
   我們文件裡寫「發現機制現成(`help`)」,看來是我寫錯了;
   想確認一下正確的指令清單查詢方式是什麼,我好修文件與 prompt


## 我這邊的用法(供參考,確認 device 設計是照你們預期在用)

    // worker 內: 值必須同步可讀, 但真值在主執行緒 -> worker 持唯讀鏡像
    mounts['/home/workspace/dev'] = {backend: 'device', files: {
      sheet: {read: () => deviceValues.sheet}      // 無 write = 唯讀
    }}

寫入刻意不做(走既有的 tool),避免「worker 寫了但主執行緒還不知道」的雙向分岔。
`echo x > dev/sheet` 正確回 `EROFS: device 'sheet' 為唯讀` code 1 ✅


## 根因與修正(20260814;0.4.2 出貨)

 - **head NUL**:shelljs 的 head 以 64KB fd chunk 迴圈讀到「湊滿 N 行」——
   device 行數不足 N(bare head 的 N=10)時多讀一輪,zenfs 對 device fd 的
   讀取回報長度與實際填充不符,padding 就進了輸出。`head -n 2` 沒中是因為
   第一輪就湊滿。修正:head/tail 改自製(readFileSync 依 stat size 配置,
   device live stat 下讀多少配多少),不再走 shelljs fd 路徑。
   device bare head 實測回原樣無 NUL;一般檔案行為不變。
 - **sed -n 1p**:非 device 問題 — esh 的 sed 只支援 `s///` 運算式
   (可 `;` 串接),位址列印(`Np`)不支援,會回 code 1 + 說明。
   替代:`head -n 1`。
 - **help**:0.4.2 新增 `help` builtin,列出全部可用指令(含 per-shell
   自訂與 functions)+ 語法摘要。程式化取得同清單:`__complete cmd ''`。
   文件可以寫「發現機制:help」了。
