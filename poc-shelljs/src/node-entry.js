// @plotdb/esh Node 宿主 entry — 零墊片:
// Node 裡 shelljs 的 require('fs') 天然解析到真 fs, 不需 alias/打包
import fs from "fs";
import shell from "shelljs";
import parse from "bash-parser";
import fg from "fast-glob";
import { esh } from "./base.js";

shell.config.silent = true;

// createShell() → 真 fs (小心: 指令直接作用於本機檔案系統)
// createShell({ fs: memfs 之類 }) → 沙箱模式 (注意 shelljs 仍綁真 fs,
//   完整沙箱需 fs 與 shell 同世界 — 見 base.js 不變量)
export function createShell(opts) {
  return Promise.resolve(esh({
    fs: (opts && opts.fs) || fs,
    shell, parse, fg
  }));
}

export { esh, fs };
