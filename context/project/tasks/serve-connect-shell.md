# serveShell / connectShell — worker shell 的標準協定與 client

來自 0802-agent 專案(browser agent runtime)的需求提案,請評估。


## 背景

外部專案要把 esh 當 runtime 用:agent(LLM tool loop)跑在自己的 worker 內,
`import { createShell } from '@plotdb/esh'` 自組,不用 dist/esh-worker.js。
主執行緒有多個消費者(chat UI、sandbox 渲染、之後的檔案上傳/編輯器)需要跟 worker 內的
shell 與 fs 互動。與其每個消費者自訂 postMessage 方言,希望 esh 把「跨執行緒使用 shell」
做成正式能力。


## 提案 API

worker 側:

    serveShell(sh, target)   # target 如 self; 把協定 handler 掛上去

協定(exec 沿用現有 shell.worker.js 格式,fs 為新增):

    {id, type: 'exec', cmdline}                        -> {stdout, stderr, code, cwd}
    {id, type: 'fs', op: 'readFile'|'writeFile', args} -> {result} | {error}

主執行緒側:

    const sh = await connectShell(worker);   # 或 workerUrl
    await sh.run('ls blocks/');
    await sh.fs.readFile('blocks/foo/index.html');
    await sh.fs.writeFile('data/upload.csv', text);

介面與 `createShell()` 同形狀(子集),讓消費端程式不分本地/worker shell 寫一次通用。


## 設計原則:fs 只有 readFile / writeFile 兩個 op

 - 區分 control-plane 與 data-plane:路徑類操作(mkdir / rm / mv / test)參數短、
   走 exec 無負擔,不重複做成 fs op;`writeFile` 自動建父目錄,連 mkdir 的常見需求都消失
 - 任意內容(整份 html / csv)不可經過 shell parser — heredoc / quoting escaping 是
   原則性風險,故內容傳輸走 structured op;`readFile` 成對提供
 - 結構化查詢(如檔案清單含 mtime)不開第三套:用 `registerCommand` 自訂指令
   stdout 輸出 JSON,留在 shell 世界
 - 所有訊息(exec + fs)進同一條 promise queue 序列化,單一 worker 權威保證一致性


## Dogfooding

 - `dist/esh-worker.js` 改用 `serveShell` 實作(exec 協定不變,既有用戶無感)
 - esh-term 的 client 端改用 `connectShell`


## 使用方(0802-agent)的接法

    // agent-worker.js
    const sh = await createShell({mounts: {'/home': {backend: 'opfs'}}});
    serveShell(sh, self);              // exec + fs 協定
    self.onmessage 疊 chat 訊息        // agent loop 自己的協定, 與 serveShell 並存

    // 主執行緒
    const sh = await connectShell(worker);      // sandbox 讀 block、上傳資料檔
    createTerminal(el, {workerUrl});            // esh-term 掛同一個 worker

需要確認:serveShell 與使用方自己的 onmessage handler 並存的方式
(target 上多個 listener?或 serveShell 回傳 dispatch 函式由使用方統一分派?)。


## 待評估

 - 命名與 API 形狀是否合 esh 的設計方向
 - fs op 白名單只有 readFile / writeFile 是否足夠(使用方立場:足夠)
 - binary 內容(之後圖檔)的傳輸格式要不要現在定(transferable / base64)
 - 版本:預計 0.2.0?

## 評估定案(20260810,esh 側;已依此實作出貨 0.2.0)

 - 命名 OK。「同形狀」修正:本地 promise 版內容傳輸掛 `sh.io`
   (readFile/writeFile 同簽名),`sh.fs` 保持 zenfs node-style 原物件 —
   connectShell 回傳 {run, io, cwd, ready, worker, dispose},
   消費端 local/remote drop-in 以 io 為準
 - fs 白名單兩個 op 夠;append 亦不可走 exec >>(內容一樣過 parser),
   pattern = read + concat + write(同一 queue 序列化, 無 race),文件註明
 - 並存:serveShell 用 addEventListener(不搶 onmessage),只認
   exec/fs/hello 三個 type;多 consumer 細節 — 廣播靠 id 過濾、
   connectShell id 帶隨機前綴防撞號、hello 重試握手(晚 attach /
   serveShell 晚掛如 OPFS 掛載中皆可連)
 - binary 語意現在定:writeFile 收 string | Uint8Array(structured
   clone 原生, 不用 base64);readFile encoding 預設 utf8, null/'binary'
   回 Uint8Array。transferable 為未來傳輸優化, API 不受影響
 - 版本 0.2.0;dogfooding 完成(esh-worker 以 serveShell 實作、
   term client 以 connectShell);迴歸 test/remote.mjs 17/17 +
   瀏覽器實機(index 終端 + tests 6/6、bundle-test 9/9、
   真 Worker 雙 client + io + binary + OPFS)
