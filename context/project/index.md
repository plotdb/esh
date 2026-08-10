# @plotdb/esh

esh — embeddable shell runtime for JavaScript。
shell 語法直譯器 + 虛擬檔案系統(ZenFS),宿主:瀏覽器(OPFS 持久化)/
Node(零墊片)/ Worker。源起為 browser-shell 實驗(不依賴 WebContainers、
授權乾淨的純前端 shell),現為 publish-ready 套件(v0.0.1 未發佈)。

## Quick guide

- 跑起來:`npm i` → `npm run build`(產 dist/)→ `npm start`(demo)
  或 `npm run dev`(vite 迴歸測試頁, /web/vitedev/m2.html 與 m25.html)
- 讀懂架構與現況:`features.md`
- 決策史與開放項目:`plan.md`(重點:「模組化與演化路線」段落)
- 開發環境的坑:`dev-notes.md`(改 shim 要清 vite cache 等, 必讀)
- 逐日記錄:`logs/`

## 文件

- `plan.md` — 計畫全史:兩條路線、milestones、模組化/演化路線、命名決策
- `features.md` — 目前系統的架構、支援語法、指令、測試矩陣、已知限制
- `dev-notes.md` — 開發環境操作備忘(工具鏈的坑)
- `tasks/` — 工作項目(syntax-edges 已全數完成)
- `logs/` — 工作記錄(yyyymmdd-*.md)

## 對話脈絡

本專案 2026-08-09~10 於 Claude Code 完成初版
(session_01LHyfSxqNX7beSUNYFBV4hp);續作以本目錄文件為準,
不需原始對話。
