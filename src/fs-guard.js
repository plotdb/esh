// passthrough 圍堵守衛 (node-zenfs 限定, 見 tasks/node-entry-zenfs.md):
// zenfs 的 chroot 只管虛擬路徑解析, 但 Passthrough 底下是真磁碟 —
// jail 內既有的真 symlink 由真 fs 解析, 可指向 prefix 外 (實測會穿)。
// 這裡把交給 Passthrough 的 fs 包一層: 每個帶路徑的呼叫都先做
// realpath containment 檢查, 解析後落在 prefix 外一律 EACCES。
// 零 import — 只用呼叫者傳入的真 fs, 不受打包 alias 影響。posix 路徑限定。

function dirOf(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function eacces(p) {
  const e = new Error("EACCES: path escapes passthrough jail, '" + p + "'");
  e.code = "EACCES";
  e.errno = -13;
  e.path = p;
  return e;
}

// realFs: 真 node fs (module 或相容物件); prefix: jail 目錄 (須已存在)
export function guardFs(realFs, prefix) {
  const jail = realFs.realpathSync(prefix);
  const inside = (p) => p === jail || p.indexOf(jail + "/") === 0;

  // 檢查一個絕對路徑: 最近存在祖先的 realpath 須在 jail 內;
  // 路徑本身若是 symlink, 解析結果也須在 jail 內 (斷掉的一律拒 —
  // 斷 symlink 指外, 之後的 write 會在 jail 外建檔)
  const check = (p) => {
    let d = p, anc = null;
    while(true) {
      try { anc = realFs.realpathSync(d); break; }
      catch(e) { const nd = dirOf(d); if(nd === d) throw e; d = nd; }
    }
    if(!inside(anc)) throw eacces(p);
    let st = null;
    try { st = realFs.lstatSync(p); } catch(e) {}
    if(st && st.isSymbolicLink()) {
      let rp = null;
      try { rp = realFs.realpathSync(p); } catch(e) { throw eacces(p); }
      if(!inside(rp)) throw eacces(p);
    }
  };

  // 帶路徑的引數一律是絕對路徑 (Passthrough 已 join prefix);
  // 'utf8' / 'w' 這類選項字串不以 / 開頭, 不會誤傷
  const checkArgs = (args) => {
    for(let i = 0; i < args.length; i++)
      if(typeof args[i] === "string" && args[i].charAt(0) === "/") check(args[i]);
  };

  const wrap = (obj, isPromises) => new Proxy(obj, {
    get(t, k) {
      const v = t[k];
      if(k === "promises" && v && typeof v === "object") return wrap(v, true);
      if(typeof v !== "function") return v;
      if(isPromises) return (...args) => {
        try { checkArgs(args); } catch(e) { return Promise.reject(e); }
        return v.apply(t, args);
      };
      return (...args) => {
        try { checkArgs(args); }
        catch(e) {
          // callback 形式的 async API: 錯誤走 callback, 不同步 throw
          const cb = args[args.length - 1];
          if(typeof cb === "function") return cb(e);
          throw e;
        }
        return v.apply(t, args);
      };
    }
  });

  return wrap(realFs, false);
}
