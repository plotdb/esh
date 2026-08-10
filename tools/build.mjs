// @plotdb/esh 打包 — esbuild only, 不依賴 vite
// 產出: dist/esh.js (ESM) + dist/esh.iife.js (window.esh)
// 並複製到 web/static/assets/esh/ 供 fedev 頁面使用
import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
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

const common = {
  entryPoints: [r("../src/bundle-entry.js")],
  bundle: true,
  platform: "browser",
  alias,
  inject: [r("../src/global-inject.js")],
  define: { "process.env.NODE_ENV": "\"production\"" },
  logLevel: "info"
};

Promise.all([
  esbuild.build({ ...common, format: "esm", outfile: r("../dist/esh.js") }),
  esbuild.build({ ...common, format: "iife", globalName: "esh", outfile: r("../dist/esh.iife.js") })
]).then(() => {
  mkdirSync(r("../web/static/assets/esh"), { recursive: true });
  copyFileSync(r("../dist/esh.js"), r("../web/static/assets/esh/esh.js"));
  copyFileSync(r("../dist/esh.iife.js"), r("../web/static/assets/esh/esh.iife.js"));
  console.log("done (dist/ + web/static/assets/esh/)");
}).catch(() => process.exit(1));
