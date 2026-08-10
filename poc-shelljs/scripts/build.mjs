// bundle 層打包 — esbuild only, 不依賴 vite
// alias/polyfill 於此一次解掉, 產出 self-contained ESM
import esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

const alias = {
  fs: r("../src/fs-zen-shim.js"),
  "node:fs": r("../src/fs-zen-shim.js"),
  process: r("../src/process-shim.js"),
  "node:process": r("../src/process-shim.js"),
  os: r("../src/os-shim.js"),
  "node:os": r("../src/os-shim.js"),
  execa: r("../src/execa-shim.js"),
  child_process: r("../src/child_process-shim.js"),
  "node:child_process": r("../src/child_process-shim.js"),
  path: "path-browserify",
  "node:path": "path-browserify",
  events: "events",
  "node:events": "events",
  stream: "stream-browserify",
  "node:stream": "stream-browserify",
  util: "util",
  "node:util": "util",
  buffer: "buffer",
  "node:buffer": "buffer",
  assert: "assert",
  "node:assert": "assert"
};

esbuild.build({
  entryPoints: [r("../src/bundle-entry.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: r("../dist/browser-shell.js"),
  alias,
  inject: [r("../src/global-inject.js")],
  define: { "process.env.NODE_ENV": "\"production\"" },
  logLevel: "info"
}).then(() => console.log("done")).catch(() => process.exit(1));
