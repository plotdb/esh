// bundle 檢查: 主 entry 不得混入 optional pack 的依賴 (防未來誤 import)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));
let bad = 0;

[["../dist/esh.js", "isomorphic-git"], ["../dist/esh-term.js", "isomorphic-git"],
 ["../dist/esh-worker.js", "isomorphic-git"]].forEach(([f, needle]) => {
  if(!existsSync(r(f))) { console.log("  - " + f + " 不存在, 跳過 (先 npm run build)"); return; }
  if(readFileSync(r(f), "utf8").indexOf(needle) >= 0) {
    console.log("  ✘ " + f + " 混入了 " + needle);
    bad++;
  } else console.log("  ✔ " + f + " 不含 " + needle);
});

if(bad) process.exit(1);
console.log("[check-bundle] ok");
