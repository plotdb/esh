// device backend — callback-backed 檔案 (0.4.0)
// 需求與約束見 tasks/scoped-root-and-device-backend.md:
//  1. sync-authoritative: 繼承 zenfs DeviceFS(char device — vnode 對 char
//     device bypassCache, 讀寫直達 driver, 無鏡像無快取)
//  2. stat size 當場算: 覆寫 stat/statSync, 每次 stat 都物化一次內容取長度 —
//     readFileSync 依 stat size 配 buffer, size 過期會被截斷/補零且看似正常
//  3. read-only 可宣告: 無 write callback → EROFS, 不靜默成功
// 範圍: 整檔 read / write(offset 0);不支援 append / seek / 部分寫入。
// device 內容是 volatile 的 — 兩次讀之間值可變, 消費端的樂觀鎖語意自行處理。
import { DeviceFS } from "@zenfs/core";

const enc = new TextEncoder();
const dec = new TextDecoder();

function materialize(spec, name) {
  const v = spec.read();
  if(v instanceof Uint8Array) return v;
  if(typeof v === "string") return enc.encode(v);
  throw new Error("device '" + name + "': read() 需回 string 或 Uint8Array");
}

class EshDeviceFS extends DeviceFS {
  constructor(files) {
    super();
    this._specs = {};
    for(const name of Object.keys(files || {})) {
      const spec = files[name];
      if(typeof spec.read !== "function")
        throw new Error("device '" + name + "': 需要 read()");
      const driver = {
        name,
        singleton: true,
        init: () => ({ metadata: {} }),
        read: (device, buffer, offset, end) => {
          const data = materialize(spec, name);
          const slice = data.subarray(Math.min(offset, data.length), Math.min(end, data.length));
          buffer.set(slice, 0);
        },
        write: (device, data, offset) => {
          if(typeof spec.write !== "function") {
            const e = new Error("EROFS: device '" + name + "' 為唯讀");
            e.code = "EROFS";
            throw e;
          }
          if(offset)
            throw new Error("device '" + name + "': 僅支援整檔寫入 (offset 0)");
          spec.write(spec.binary ? new Uint8Array(data) : dec.decode(data));
        }
      };
      this._createDevice(driver);
      this._specs["/" + name] = spec; // 建好 device 後才掛 spec (statSync 覆寫依賴 devices map)
    }
  }
  // stat size 每次當場物化 — 不回快取值 (約束 2)
  _liveStat(path) {
    const spec = this._specs[path];
    const dev = spec && this.devices.get(path);
    if(!dev) return null;
    dev.inode.update({ size: materialize(spec, path).length, mtimeMs: Date.now() });
    return dev.inode;
  }
  async stat(path) { return this._liveStat(path) || super.stat(path); }
  statSync(path) { return this._liveStat(path) || super.statSync(path); }
}

// zenfs backend 物件 — bundle-entry 的 mounts {backend: 'device', files} 用
export const EshDevice = {
  name: "EshDevice",
  options: { files: { type: "object", required: true } },
  create(options) { return new EshDeviceFS(options.files); }
};
