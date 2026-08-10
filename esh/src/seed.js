// fs-agnostic 測試資料種子 (memfs / zenfs 皆可用 — 走 alias 後的 'fs')
import fs from "fs";

const TREE = {
  "/home/web/README.md": "# demo\nshell in browser\nfind the needle here\n",
  "/home/web/src/a.js": "const x = 1;\nconsole.log(\"needle\", x);\n",
  "/home/web/src/b.txt": "banana\napple\ncherry\napple\n",
  "/home/web/src/nested/c.txt": "deep needle\n",
  "/home/web/nums.txt": "10\n2\n33\n4\n",
  "/tmp/.keep": ""
};

export function seed() {
  ["/home/web", "/tmp"].forEach((d) => {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch(e) { /* 不存在 */ }
  });
  Object.keys(TREE).forEach((p) => {
    const dir = p.slice(0, p.lastIndexOf("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, TREE[p]);
  });
}
