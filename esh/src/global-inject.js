// esbuild inject: 自由識別字 Buffer / process 的替身
import { Buffer as _Buffer } from "buffer";
import _process from "./process-shim.js";
export { _Buffer as Buffer, _process as process };
