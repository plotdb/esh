// serveShell / connectShell — 跨執行緒(worker/main thread)使用 shell 的標準協定。
// 零依賴、transport-agnostic:target 只需有 postMessage + addEventListener('message')
// 的形狀(Worker / self / MessagePort;跨裝置可自寫同形狀 adapter, 但序列化要自理)。
//
// 協定(exec 沿用 shell.worker.js 既有格式, 既有用戶無感):
//   {id, type:'exec', cmdline}                          → {id, type:'result', stdout, stderr, code, cwd}
//   {id, type:'fs', op:'readFile'|'writeFile', args}    → {id, type:'fs-result', result} | {…, error}
//   {id, type:'hello'}                                  → {id, type:'ready', cwd, ...info}
// 設計原則見 context/project/tasks/serve-connect-shell.md:
// 路徑類操作走 exec(control-plane), 任意內容走 fs op(data-plane, 不經 shell parser);
// append 亦不可走 exec >>(內容一樣過 parser)— 用 readFile+concat+writeFile,
// 單一 queue 序列化下沒有 race。

// worker 側: 把協定 handler 掛上 target。info(如 {persist})併入 ready 回覆。
// 只認 exec/fs/hello 三種 type, 其餘不碰 — 使用方自己的協定可在同一 target 並存
// (約定 type 避開這三個名字)。回傳 {dispose} 可解掛。
export function serveShell(sh, target, info) {
  // exec 與 fs 進同一條 promise queue — 單一 worker 權威, 保證一致性
  let queue = Promise.resolve();
  const enqueue = (job) => {
    const p = queue.then(job);
    queue = p.catch(() => {});
    return p;
  };
  const handler = (ev) => {
    const msg = ev.data;
    if(!msg || !msg.id) return;
    if(msg.type === "hello") {
      target.postMessage(Object.assign({ id: msg.id, type: "ready", cwd: sh.cwd() }, info || {}));
      return;
    }
    if(msg.type === "exec") {
      enqueue(async () => {
        let r;
        try { r = await sh.run(msg.cmdline); }
        catch(e) { r = { stdout: "", stderr: "internal: " + e.message, code: 1 }; }
        target.postMessage({
          id: msg.id, type: "result",
          stdout: r.stdout || "", stderr: r.stderr || "", code: r.code || 0,
          cwd: sh.cwd()
        });
      });
      return;
    }
    if(msg.type === "fs") {
      enqueue(async () => {
        try {
          if(!sh.io || typeof sh.io[msg.op] !== "function") throw new Error("不支援的 fs op: " + msg.op);
          const result = await sh.io[msg.op].apply(null, msg.args || []);
          target.postMessage({ id: msg.id, type: "fs-result", result });
        } catch(e) {
          target.postMessage({ id: msg.id, type: "fs-result", error: e.message });
        }
      });
    }
  };
  target.addEventListener("message", handler);
  return { dispose: () => target.removeEventListener("message", handler) };
}

// 主執行緒側: 連上 serveShell 的 target, 回傳與 createShell 同形狀的子集
// {run, io, cwd, worker, dispose}。workerOrUrl 可為 Worker 實例或 workerUrl 字串。
// id 帶隨機前綴 — 同一 worker 可掛多個 client(dedicated worker 的 postMessage
// 是廣播, 各 client 靠 id 過濾彼此的訊息, 前綴避免撞號)。
// 以 hello 重試握手, 不依賴 serveShell 掛上前的初始 ready 廣播
// (worker 端 top-level await — 如 OPFS 掛載 — 期間送達的訊息會丟失)。
export function connectShell(workerOrUrl, opts) {
  opts = opts || {};
  const worker = typeof workerOrUrl === "string"
    ? new Worker(workerOrUrl, { type: "module" })
    : workerOrUrl;
  const prefix = "c" + Math.random().toString(36).slice(2, 10) + "-";
  let seq = 0;
  const pending = {};
  const handler = (ev) => {
    const m = ev.data;
    if(!m || !m.id || !pending[m.id]) return; // 不是自己的訊息(含別的 client 的)
    const res = pending[m.id];
    delete pending[m.id];
    res(m);
  };
  worker.addEventListener("message", handler);
  const send = (msg) => new Promise((res) => {
    msg.id = prefix + (++seq);
    pending[msg.id] = res;
    worker.postMessage(msg);
  });
  const unwrapFs = (m) => {
    if(m.error !== undefined) throw new Error(m.error);
    return m.result;
  };

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timeout = opts.timeout || 15000;
    let timer = null;
    const attempt = () => {
      const id = prefix + (++seq);
      pending[id] = (ready) => {
        clearTimeout(timer);
        const api = {
          run: (cmdline) => send({ type: "exec", cmdline }).then((m) => {
            api.cwd = m.cwd;
            return { stdout: m.stdout, stderr: m.stderr, code: m.code, cwd: m.cwd };
          }),
          io: {
            readFile: (path, encoding) =>
              send({ type: "fs", op: "readFile", args: encoding === undefined ? [path] : [path, encoding] }).then(unwrapFs),
            writeFile: (path, content) =>
              send({ type: "fs", op: "writeFile", args: [path, content] }).then(unwrapFs),
            readdir: (path, opts) =>
              send({ type: "fs", op: "readdir", args: opts === undefined ? [path] : [path, opts] }).then(unwrapFs),
            stat: (path) =>
              send({ type: "fs", op: "stat", args: [path] }).then(unwrapFs)
          },
          cwd: ready.cwd,
          ready, // 完整 ready 訊息 (含 serveShell info, 如 persist)
          worker,
          dispose: () => worker.removeEventListener("message", handler)
        };
        resolve(api);
      };
      worker.postMessage({ id, type: "hello" });
      if(Date.now() - started > timeout) {
        worker.removeEventListener("message", handler);
        reject(new Error("connectShell: 握手逾時 (" + timeout + "ms)"));
        return;
      }
      timer = setTimeout(attempt, 250);
    };
    attempt();
  });
}
