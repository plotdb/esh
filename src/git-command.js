// @plotdb/esh/git — optional git command pack (isomorphic-git)
// core 不 import 本檔;消費者 opt-in:
//   createShell({ commands: gitCommands(opts) }) 或 installGit(sh, opts)
// 指令經 ctx.esh({fs, cwd}, base.js 注入)碰檔案;第一版 local only
// (clone/fetch/pull/push 需 HTTP transport/CORS/auth 設計, 另案)。
// 設計與取捨見 context/project/tasks/git-support/plan.md。
import * as git from "isomorphic-git";

export function gitCommands(opts) {
  return { git: makeGit(opts || {}) };
}

export function installGit(sh, opts) {
  sh.registerCommand(gitCommands(opts));
  return sh;
}

// posix 路徑正規化 + 轉 repo root 相對(isomorphic-git 的 filepath 一律
// 相對 root;esh cwd 可能在 repo 子目錄)
function normAbs(cwd, p) {
  const abs = p.charAt(0) === "/" ? p : cwd + "/" + p;
  const parts = [];
  abs.split("/").forEach((s) => {
    if(!s || s === ".") return;
    if(s === "..") parts.pop();
    else parts.push(s);
  });
  return "/" + parts.join("/");
}
function toRepoPath(root, cwd, p) {
  const a = normAbs(cwd, p);
  if(a === root) return ".";
  if((a + "/").indexOf(root === "/" ? "/" : root + "/") !== 0)
    throw new Error("'" + p + "' 在 repo 之外 (root: " + root + ")");
  return a.slice(root === "/" ? 1 : root.length + 1);
}

// statusMatrix row [filepath, head, workdir, stage] → porcelain XY (clean 回 null)
const STATUS_XY = {
  "0,2,0": "??", "0,2,2": "A ", "0,2,3": "AM", "0,0,3": "AD",
  "1,2,1": " M", "1,2,2": "M ", "1,2,3": "MM",
  "1,0,1": " D", "1,0,0": "D ", "1,1,0": "D ", "1,2,0": "DA",
  "1,1,1": null
};
function statusXY(head, workdir, stage) {
  const xy = STATUS_XY[head + "," + workdir + "," + stage];
  return xy === undefined ? "??" : xy;
}

function makeGit(opts) {
  return async function gitCommand(argv, stdin, ctx) {
    if(!ctx.esh || !ctx.esh.fs)
      return { stdout: "", stderr: "git: 此 shell 未提供 ctx.esh (需 0.3.0+ 的 base.js)", code: 1 };
    const fs = ctx.esh.fs;
    const cwd = ctx.esh.cwd();
    const sub = argv[0], args = argv.slice(1);
    if(!sub) return { stdout: "", stderr: "git: 缺少 subcommand", code: 1 };

    if(sub === "init") {
      await git.init({ fs, dir: cwd });
      return "Initialized empty Git repository in " + cwd + "/.git\n";
    }

    // init 以外都需要 repo root(子目錄下指令用 findRoot 找)
    let dir;
    try { dir = await git.findRoot({ fs, filepath: cwd }); }
    catch(e) { return { stdout: "", stderr: "git: not a git repository (or any parent): " + cwd, code: 128 }; }

    if(sub === "config") {
      const path = args[0], value = args[1];
      if(!path) return { stdout: "", stderr: "git config: 需要 key (如 user.name)", code: 1 };
      if(value === undefined) {
        const v = await git.getConfig({ fs, dir, path });
        return v === undefined ? { stdout: "", stderr: "", code: 1 } : v + "\n";
      }
      await git.setConfig({ fs, dir, path, value });
      return "";
    }

    if(sub === "add") {
      if(!args.length) return { stdout: "", stderr: "git add: 需要路徑 (或 .)", code: 1 };
      for(const a of args) {
        const rp = toRepoPath(dir, cwd, a);
        if(rp === "." || a === ".") {
          // add . : 以 statusMatrix 掃全 repo — 新增/修改 add, 刪除 remove
          const rows = await git.statusMatrix({ fs, dir });
          for(const [fp, , workdir] of rows) {
            if(workdir === 0) await git.remove({ fs, dir, filepath: fp });
            else await git.add({ fs, dir, filepath: fp });
          }
        } else {
          // 刪除中的檔案 add 等同 stage 刪除
          const st = await git.status({ fs, dir, filepath: rp });
          if(st === "*deleted" || st === "deleted") await git.remove({ fs, dir, filepath: rp });
          else await git.add({ fs, dir, filepath: rp });
        }
      }
      return "";
    }

    if(sub === "status") {
      const rows = await git.statusMatrix({ fs, dir });
      const lines = [];
      for(const [fp, head, workdir, stage] of rows) {
        const xy = statusXY(head, workdir, stage);
        if(xy) lines.push(xy + " " + fp);
      }
      let branch = await git.currentBranch({ fs, dir, fullname: false });
      if(!branch) branch = "(detached HEAD)";
      if(!lines.length) return "On branch " + branch + "\nnothing to commit, working tree clean\n";
      return "On branch " + branch + "\n" + lines.join("\n") + "\n";
    }

    if(sub === "commit") {
      let message = null;
      for(let i = 0; i < args.length; i++)
        if(args[i] === "-m") { message = args[i + 1]; i++; }
      if(!message) return { stdout: "", stderr: "git commit: 需要 -m <message>", code: 1 };
      const name = await git.getConfig({ fs, dir, path: "user.name" })
        || (opts.author && opts.author.name);
      const email = await git.getConfig({ fs, dir, path: "user.email" })
        || (opts.author && opts.author.email);
      if(!name || !email)
        return { stdout: "", stderr: "git commit: 未設定 author — 先 git config user.name <name> 與 git config user.email <email>", code: 1 };
      const oid = await git.commit({ fs, dir, message, author: { name, email } });
      const branch = await git.currentBranch({ fs, dir, fullname: false });
      return "[" + (branch || "detached") + " " + oid.slice(0, 7) + "] " + message.split("\n")[0] + "\n";
    }

    if(sub === "log") {
      const oneline = args.indexOf("--oneline") >= 0;
      let depth = 50;
      const nIdx = args.indexOf("-n");
      if(nIdx >= 0) depth = Number(args[nIdx + 1]) || depth;
      let commits;
      try { commits = await git.log({ fs, dir, depth }); }
      catch(e) { return { stdout: "", stderr: "git log: " + e.message, code: 128 }; }
      const out = commits.map((c) => {
        if(oneline) return c.oid.slice(0, 7) + " " + c.commit.message.split("\n")[0];
        return "commit " + c.oid + "\nAuthor: " + c.commit.author.name + " <" + c.commit.author.email + ">\nDate:   " +
          new Date(c.commit.author.timestamp * 1000).toISOString() + "\n\n    " +
          c.commit.message.replace(/\n+$/, "").split("\n").join("\n    ") + "\n";
      });
      return out.join("\n") + "\n";
    }

    if(sub === "branch") {
      if(!args.length) {
        const branches = await git.listBranches({ fs, dir });
        const cur = await git.currentBranch({ fs, dir, fullname: false });
        return branches.map((b) => (b === cur ? "* " : "  ") + b).join("\n") + "\n";
      }
      await git.branch({ fs, dir, ref: args[0] });
      return "";
    }

    if(sub === "checkout") {
      if(!args.length) return { stdout: "", stderr: "git checkout: 需要 ref", code: 1 };
      try { await git.checkout({ fs, dir, ref: args[0] }); }
      catch(e) {
        // isomorphic-git 對非 branch/tag 的 ref 會 fallback 找 origin/<ref>,
        // 錯誤訊息誤導 — oid 形狀的 ref 給明確說法 (detached HEAD 未支援)
        if(/^[0-9a-f]{4,40}$/.test(args[0]))
          return { stdout: "", stderr: "git checkout: 第一版僅支援 branch/tag (以 commit oid 進 detached HEAD 未支援)", code: 1 };
        return { stdout: "", stderr: "git checkout: " + e.message, code: 128 };
      }
      return "";
    }

    return { stdout: "", stderr: "git: 不支援的 subcommand '" + sub + "' (第一版 local only: init/config/add/status/commit/log/branch/checkout)", code: 1 };
  };
}
