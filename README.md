# @plotdb/esh

esh — embeddable shell runtime for JavaScript.

A shell syntax interpreter with a virtual file system. Runs in the browser
( with optional OPFS persistence ), in Node, and in workers.

Supported syntax: pipes, redirects ( `>` `>>` `<` `2>`, heredoc ), variable
expansion and quoting, glob, command substitution `$(...)`, arithmetic
`$(( ))`, `if` / `for` / `while` / `case`, functions, `local`, `$@`, custom
`IFS`, `xargs`, and more. Commands are currently provided by ShellJS; see the
project plan for the evolution roadmap.


## Usage

### Browser ( ESM )

    <script type="module">
      import { createShell } from '@plotdb/esh';   // with a bundler
      // or directly: import { createShell } from './dist/esh.js';
      const sh = await createShell();
      const r = await sh.run('ls | grep foo');     // { stdout, stderr, code }
    </script>

With OPFS persistence:

    const sh = await createShell({ mounts: { '/home': { backend: 'opfs' } } });

### Browser ( non-ESM, `window.esh` )

    <script src="dist/esh.iife.js"></script>
    <script>
      esh.createShell().then(function(sh) { sh.run('echo hi'); });
    </script>

### Node

    import { createShell } from '@plotdb/esh';   // real fs, no shims needed
    const sh = await createShell();
    // sandbox: createShell({ fs: a memfs instance }) — note that fs and shell
    // must share the same fs implementation; see src/base.js

### Terminal ( `esh-term`, shipped with the main package as separate files )

    <link rel="stylesheet" href="dist/esh-term.css">
    <script src="dist/esh-term.iife.js"></script>
    <script>
      // deploy dist/esh-worker.js next to esh-term, or pass workerUrl
      eshTerm.createTerminal(document.getElementById('term'));
    </script>

ESM: `import { createTerminal } from '@plotdb/esh/term'`. The shell runs in a
Web Worker ( `esh-worker.js`, which contains the full engine ), with `/home`
mounted on OPFS for persistence.

### Cross-thread shell ( `serveShell` / `connectShell` )

Serve a shell from a worker and use it from the main thread ( or any
`postMessage`-shaped transport ). Multiple clients can share one worker:

    // worker
    import { createShell, serveShell } from '@plotdb/esh';
    const sh = await createShell({ mounts: { '/home': { backend: 'opfs' } } });
    serveShell(sh, self);

    // main thread
    import { connectShell } from '@plotdb/esh';
    const sh = await connectShell(worker);       // or a worker URL
    await sh.run('ls');
    await sh.io.writeFile('/home/web/data.csv', text);   // content bypasses the parser
    await sh.io.readFile('/home/web/img.png', null);     // Uint8Array

Local shells expose the same `sh.io` subset, so consumer code works with
either. `serveShell` uses `addEventListener` and only handles its own message
types ( `exec` / `fs` / `hello` ) — your own worker protocol can coexist.

### Git ( optional command pack, `@plotdb/esh/git` )

Local-only git commands backed by isomorphic-git ( `init` / `config` / `add` /
`status` / `commit` / `log` / `branch` / `checkout` ). Not included in the main
bundle — opt in per shell:

    import { createShell } from '@plotdb/esh';
    import { installGit } from '@plotdb/esh/git';
    const sh = installGit(await createShell());
    await sh.run('git init && git config user.name me && git config user.email m@e');
    await sh.run('echo hi > a.txt && git add . && git commit -m first');

Network commands ( clone / fetch / pull / push ) are not supported yet.

### Advanced: bring your own dependencies ( base layer )

    import { esh } from '@plotdb/esh/base';
    const sh = esh({ fs, shell, parse, fg });    // bundler-agnostic


## Development

 - `npm run build` — bundle with esbuild into `dist/` ( esm + iife ), then
   copy to `web/static/assets/esh/`
 - `npm run dev` — vite dev server for regression test pages under
   `web/vitedev/`: `m2.html` ( command survival table, 81 cases ),
   `m25.html` ( syntax cases, 72 cases ), `terminal.html`
   ( xterm + worker + OPFS )
 - `npm start` — fedev template server ( `web/`: pug demo and static pages,
   consuming `dist/` artifacts only )

Vite is only used by the test pages under `web/vitedev/`, which need
source-level alias resolution; the shipped artifacts and the `web/` demo do
not depend on vite. The early PoC ( `poc-shelljs/` ) has been removed; see
git history for the full evolution.


## License

MIT
