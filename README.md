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
    // scope storage per page: { backend: 'opfs', path: 'my-app' } mounts a
    // subdirectory of origin storage; { backend: 'indexeddb', storeName: 'x' }
    // uses a separate store — same-origin workspaces stay isolated

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

### Node with virtual fs ( `@plotdb/esh/node-zenfs` )

Same behavior as the browser bundle — `mounts`, `root` ( chroot ) and the
`device` backend all work; the browser's `opfs` maps to `passthrough`
( a real-disk subdirectory mounted into the virtual fs ):

    import { createShell } from '@plotdb/esh/node-zenfs';
    const sh = await createShell({ mounts: {
      '/home': { backend: 'passthrough', path: '/srv/ws/u123' }
    }, root: '/home/workspace' });

All backends here are synchronous. Real symlinks inside the passthrough
directory that resolve outside of it are rejected ( EACCES ) by default;
pass `followSymlinks: true` on the mount to disable the guard. Requires
node >= 20.16.

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
    await sh.io.readdir('/home', { withFileTypes: true }); // [{name, isDirectory}]
    await sh.io.stat('/home/web/data.csv');   // {size, mtimeMs, isFile, isDirectory}

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

### Scoped root ( chroot — browser bundle and node-zenfs )

    const sh = await createShell({ root: '/home/ws/blocks/foo' });
    await sh.run('ls');          // sees only foo/* — "/" is the root;
                                 // cd .. / absolute paths / globs can't escape
    sh.chroot('/home/ws/blocks/bar');   // host-side JS API; retarget the root

Multiple shells can share one fs with different roots ( restricted agent +
unrestricted user terminal ), seeing each other's writes.

### Device backend ( callback-backed files — browser bundle and node-zenfs )

    const sh = await createShell({ mounts: {
      '/dev': { backend: 'device', files: {
        sheet: { read: () => currentSheetAsCSV(),      // live value, no caching
                 write: (s) => applySheet(s) }         // omit write = read-only ( EROFS )
      } }
    } });
    await sh.run('grep total /dev/sheet | wc -l');     // shell tools work on live data

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
 - `npm run web` ( alias: `npm start` ) — fedev template server ( `web/`:
   pug demo with an xterm terminal and static pages, consuming `dist/`
   artifacts only ); open the printed URL and play with the shell
 - `npm run console` — interactive shell in the terminal ( node-zenfs
   sandbox; `npm run build` first ). Mount a real directory and jail it:

       npm run console -- --mount /home=./some/dir --root /home

Vite is only used by the test pages under `web/vitedev/`, which need
source-level alias resolution; the shipped artifacts and the `web/` demo do
not depend on vite. The early PoC ( `poc-shelljs/` ) has been removed; see
git history for the full evolution.


## License

MIT
