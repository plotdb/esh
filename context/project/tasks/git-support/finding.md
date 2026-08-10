# Finding: isomorphic-git on ZenFS for @plotdb/esh

## Summary

isomorphic-git can use ZenFS directly as its `fs` backend for the local Git
operations needed by `@plotdb/esh`. No isomorphic-git core changes are required
for the validated path.

Validated commands/API paths:

- `init`
- `add`
- `commit`
- `statusMatrix`
- `log`
- `checkout`
- remounting the same ZenFS backend instance and continuing repo operations

Validated ZenFS versions:

- `@zenfs/core@2.4.0` in the isomorphic-git checkout used for the spike
- `@zenfs/core@2.6.2` in `/Users/tkirby/workspace/plotdb/projects/esh`

## Fit with @plotdb/esh

`@plotdb/esh` already supports custom commands through:

- global `registerCommand(name, fn)`
- per-shell `sh.registerCommand(name, fn)`
- `createShell({ commands })`

The recommended integration is a per-shell `git` command implemented with
isomorphic-git. The command should use `ctx.fs` as the isomorphic-git `fs`
argument and `ctx.shell.pwd()` as the default working directory.

Prefer per-shell registration first because it keeps Git support scoped to the
shell instance and avoids global registry side effects.

## FS compatibility

isomorphic-git's `FileSystem` wrapper accepts Node-like callback fs objects or
an enumerable `promises` API. ZenFS provides the required methods:

- `readFile`
- `writeFile`
- `mkdir`
- `rmdir`
- `unlink`
- `stat`
- `lstat`
- `readdir`
- `readlink`
- `symlink`

ZenFS also provides `rm`, which is important because isomorphic-git prefers
`fs.rm` for recursive deletion when available.

One observed semantic difference: ZenFS `rmdir(path, { recursive: true })` did
not recursively remove a non-empty directory in the spike. This is not a blocker
for current isomorphic-git because the wrapper uses `rm` when present.

## Risks and caveats

- `statusMatrix` can show racy-stat behavior. After a clean status refreshes
  the index stat cache, a same-size rewrite within the same second can be
  reported clean because isomorphic-git compares normalized stat fields before
  hashing. This is not ZenFS-specific, but an interactive shell can hit it.
- Remount was validated by reusing the same `InMemory` backend instance. True
  reload persistence depends on esh's persistent ZenFS mount, such as OPFS.
- Remote commands (`clone`, `fetch`, `pull`, `push`) were not validated here.
  They require a separate pass for HTTP transport, CORS, auth callbacks, and URL
  policy.

## Recommendation

Adopt isomorphic-git as the implementation behind an optional esh `git` command
pack.

Start with local repository commands:

- `git init`
- `git status`
- `git add <path...>`
- `git commit -m <message>`
- `git log`
- `git branch [name]`
- `git checkout <ref>`

Defer network-backed Git commands until the local command surface is stable.
