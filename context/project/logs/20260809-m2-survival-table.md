# 20260809 — M2: ShellJS + memfs 指令存活表

## 結果:80/81 通過

測試頁:poc-shelljs/m2.html(dev server 跑起來後開 /m2.html,
81 個測項涵蓋各指令主要旗標,detail 區塊可展開逐項結果)

| 指令 | 結果 | 備註 |
|---|---|---|
| cat(-n, 多檔) | 3/3 | |
| cd/pwd(相對路徑, .., -, ~) | 5/5 | 需 shim 修正,見下 |
| chmod(數字, 符號 u+x, -R) | 3/3 | |
| cp(-r, -n, 多來源, glob) | 5/5 | |
| pushd/popd/dirs | 2/2 | |
| echo(-n, .to, .toEnd) | 4/4 | |
| error() | 2/2 | |
| find(多 root, filter) | 3/3 | |
| grep(-v -i -l -n, regex, glob) | 7/7 | |
| head/tail(-n, 多檔) | 4/4 | |
| ln(-s, hard, -sf, test -L) | 4/4 | |
| ls(-R -A -l -d, glob) | 6/6 | -l 回傳物件陣列 |
| mkdir(-p, 多個) | 3/3 | |
| mv(-n, dir) | 3/3 | |
| rm(-r, -f, glob) | 4/4 | |
| sed(g flag, capture group, -i) | 4/4 | |
| sort(-r, -n) | 3/3 | |
| test(-f -d -e) | 3/3 | |
| touch(-c, mtime) | 3/3 | |
| uniq(-c, -d) | 3/3 | |
| tempdir / set -e | 2/2 | |
| pipe chain(cat().grep().sed().head()) | 4/4 | |
| which | 0/1 | 預期失敗:memfs 無 PATH 執行檔,對瀏覽器場景無意義 |

## 新增 shim 修正

1. **process-shim chdir 要解析相對路徑**:Node 的 chdir 接受相對路徑並
   正規化 . / ..;原本直接存參數導致 cd 相對路徑後 pwd 回傳垃圾。
2. **os 也要換成自製 shim**(src/os-shim.js):polyfill 的 os.homedir()
   回傳 '/',導致 cd ~ 錯誤。自製版 homedir=/home/web、tmpdir=/tmp、
   cpus()(fast-glob 用)等。vite.config alias `os` → os-shim,
   並從 nodePolyfills include 移除 "os"。

## 結論

ShellJS 在 memfs 上的相容性比預期更好:**所有 fs 類指令與旗標全數通過**,
包含 symlink、mode bits、glob、pipe chain。真正不能用的只有依賴
child_process 的 exec() 與依賴 PATH 執行檔的 which()。
Track 1 可以視為驗證完成,產品化剩下的是:shell 語法解析層(pipe/redirect
字串 → API 呼叫)、OPFS 持久化(需 worker 架構)、與 Track 2 的 fs 共用。
