import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath } from "node:url";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ["path", "process", "buffer", "util", "stream", "events", "assert", "url"],
      globals: { Buffer: true, global: true, process: true }
    })
  ],
  resolve: {
    alias: {
      fs: r("./src/fs-shim.js"),
      execa: r("./src/execa-shim.js"),
      "vite-plugin-node-polyfills/shims/process": r("./src/process-shim.js"),
      process: r("./src/process-shim.js"),
      os: r("./src/os-shim.js")
    }
  }
});
