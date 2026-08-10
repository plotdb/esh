# @plotdb/esh

esh — embeddable shell runtime for JavaScript。
shell 語法直譯器 + 虛擬檔案系統,跑在瀏覽器(可 OPFS 持久化)、Node、Worker。

支援語法:pipe、redirect(`> >> < 2>`、heredoc)、`$VAR`/quoting/glob、
`$(...)`、`$(( ))` 算術、`if`/`for`/`while`/`case`/function、
`local`、`$@`、自訂 IFS、`xargs` 等。指令本體目前由 ShellJS 提供
(演化路線見專案 plan)。


## 使用

### 瀏覽器(ESM)

```html
<script type="module">
  import { createShell } from '@plotdb/esh';   // bundler 環境
  // 或直接: import { createShell } from './dist/esh.js';
  const sh = await createShell();
  const r = sh.run('ls | grep foo');           // { stdout, stderr, code }
</script>
```

OPFS 持久化:

```js
const sh = await createShell({ mounts: { '/home': { backend: 'opfs' } } });
```

### 瀏覽器(非 ESM, window.esh)

```html
<script src="dist/esh.iife.js"></script>
<script>
  esh.createShell().then(function(sh) { sh.run('echo hi'); });
</script>
```

### Node

```js
import { createShell } from '@plotdb/esh';   // 真 fs, 零墊片
const sh = await createShell();
// 沙箱: createShell({ fs: memfs 實例 }) — 注意需與 shell 同 fs, 見 src/base.js
```

### 終端(esh-term, 隨主套件出貨的獨立檔案)

```html
<link rel="stylesheet" href="dist/esh-term.css">
<script src="dist/esh-term.iife.js"></script>
<script>
  // dist/esh-worker.js 需與 esh-term 同目錄部署(或以 workerUrl 指定)
  eshTerm.createTerminal(document.getElementById('term'));
</script>
```

ESM: `import { createTerminal } from '@plotdb/esh/term'`。
shell 跑在 Web Worker(esh-worker.js, 含完整引擎),/home 掛 OPFS 持久化。

### 進階:自組依賴(base 層)

```js
import { esh } from '@plotdb/esh/base';
const sh = esh({ fs, shell, parse, fg });    // 依賴自備, bundler-agnostic
```


## 開發

- `npm run build` — esbuild 打包 dist/(esm + iife),並複製到 web/static/assets/esh/
- `npm run dev` — vite dev server,迴歸測試頁在 web/vitedev/:
  /web/vitedev/m2.html(指令存活表 81 項)、/web/vitedev/m25.html(語法測項 72 項)、
  /web/vitedev/terminal.html(xterm + worker + OPFS)
- `npm run dev:web` — fedev template server(web/:pug demo 與靜態頁,只消費 dist 成品)

vite 僅供 web/vitedev/ 測試頁(需 source-level alias);成品與 web/ demo 皆不依賴 vite。
poc-shelljs/ 為早期 PoC 歷史參照,不再維護。


## License

MIT
