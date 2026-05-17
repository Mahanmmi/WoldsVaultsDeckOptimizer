// Thin Promise-based client for `worker/optimize.worker.ts`.
// One singleton worker; each call gets a unique id and resolves when the
// matching reply arrives.

import OptimizeWorker from "../worker/optimize.worker?worker";
import type { OptimizeInput, OptimizeResult } from "./optimize";

let _worker: Worker | null = null;
let _nextId = 1;
const _pending = new Map<number, {
  resolve: (r: OptimizeResult) => void;
  reject:  (e: Error) => void;
}>();

function ensureWorker(): Worker {
  if (_worker) return _worker;
  _worker = new OptimizeWorker();
  _worker.onmessage = (ev: MessageEvent) => {
    const { id, ok, result, error } = ev.data;
    const slot = _pending.get(id);
    if (!slot) return;
    _pending.delete(id);
    if (ok) slot.resolve(result);
    else    slot.reject(new Error(error));
  };
  _worker.onerror = (e) => {
    // A fatal worker error rejects all pending calls.
    const err = new Error(`worker crashed: ${e.message}`);
    for (const slot of _pending.values()) slot.reject(err);
    _pending.clear();
    _worker?.terminate();
    _worker = null;
  };
  return _worker;
}

/** Async wrapper around the worker — runs SA in a background thread. */
export function optimizeInventoryAsync(input: OptimizeInput): Promise<OptimizeResult> {
  const w = ensureWorker();
  const id = _nextId++;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    w.postMessage({ id, input });
  });
}
