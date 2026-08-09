# browser-shell

純前端(無 Node runtime)的 shell / coreutils 能力實驗:
ShellJS + virtual fs 與 WASM coreutils 兩條路線。

## Quick guide

- 動機:WebContainers / Nodebox 閉源且商用授權不友善;
  目標是在一般網頁 JS 環境提供 shell 指令 + 虛擬檔案系統,授權乾淨。
- 目前為 PoC 階段,尚未開始寫 code。

## 文件

- `plan.md` — 實驗計畫:兩條路線(ShellJS+memfs / WASM coreutils)、
  milestones、比較維度與決策表
