# 20260902 — web demo 重整:exp 收斂 + custom worker 示範頁

## 結果

0809-stackblitz 的 exp/(fedep 消費端 playground)正式退役;其唯一不重複的
價值——**consumer 端自訂 worker 示範**——整合進本 repo 的 web/ demo,
並把 demo 重排成 landing + 兩個子頁。實測全過(dist 0.5.1)。

## web/ 新結構

- `/`(src/pug/index.pug 重寫)— landing:title + brief + 兩張卡片連到 demo
- `/terminal/`(原 index.pug 原封搬入 src/pug/terminal/)—
  內建 worker 終端(OPFS)+ tests popup(6 測項)
- `/custom/`(src/pug/custom/)— 自訂 worker 示範,配 web/static/js/custom-worker.js:
  - consumer 端 `registerCommand`:async `ask` 指令 = postMessage hostcall 往返,
    主執行緒開原生 `<dialog>` 要數字(不用 ldcover — repo 不為 demo 背依賴)
  - git pack:`eshGit.gitCommands()` 掛進 commands
  - 協定交給 `serveShell(sh, self, {persist})` 代管,hostcall 是自訂訊息型別,
    與 serveShell 並存互不干擾
- worker 與資產全用絕對路徑(/js/、/assets/esh/),頁面搬子目錄不需改路徑

## exp 的下場

- exp 當初的目的是驗「npm module(fedep 佈局)可正確使用」;async-test.html
  與 repo 版只差資產路徑,終端頁的價值即上述 custom 示範 → 拔完即棄
- 舊目錄 0809-stackblitz 僅剩搬家前快照,note.md 標明可整個刪除

## 踩到的雷

1. **`<dialog>` 的 close 事件在自動化環境可能根本不發**(Chrome 擴充對 modal
   的防護;連 `showModal(); close()` 後 addEventListener 的 close 都收不到,
   但 `open` 屬性正常切換)。第一版把 hostcall 回覆掛在 `onclose` 上 →
   ask 永不回覆 → worker 的 run 佇列永久卡死。正解:回覆掛在 ok/cancel
   按鈕 click 與 Esc(`cancel` 事件)上,close 事件僅備援,`pending` 旗標
   防重複送。真人操作與自動化下皆穩。
2. hostcall 類指令卡住時症狀是「之後所有 exec 都沒有回應」——serveShell 的
   佇列序列化所致,debug 時先想到未回覆的 hostcall,而不是協定壞掉。

## 驗證紀錄

- `/custom/`:`git` usage、`git init`+`status`、`echo>file`+`cat`、
  `n=$(ask …); echo got $n pears` 填 9 → `got 9 pears`、
  cancel → `ask: cancelled` code 1 且佇列不卡
- `/terminal/`:xterm 掛載、popup 6/6
- README Development 段同步改為 landing + 兩路徑的描述
