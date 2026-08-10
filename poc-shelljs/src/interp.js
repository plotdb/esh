// 相容層: 供 vite 開發環境(m25/worker)沿用既有 import 介面。
// 依賴經 vite alias 解析後注入 core — 新程式請改用 base.js 的 esh(ctx)。
import parse from "bash-parser";
import shell from "shelljs";
import fs from "fs";
import fg from "fast-glob";
import { initDeps } from "./core.js";

initDeps({ parse, shell, fs, fg });

export { createContext, run } from "./core.js";
