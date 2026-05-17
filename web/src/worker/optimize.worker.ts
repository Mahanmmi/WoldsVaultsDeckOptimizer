// Optimization worker. Owns the wasm instance. Receives serializable
// `OptimizeInput` payloads from the main thread, runs `optimizeInventory`,
// posts back a serializable `OptimizeResult` (or an error).
//
// Map / Placed (tuples) survive structured clone fine, so no extra
// serialization is needed.

import { optimizeInventory, type OptimizeInput, type OptimizeResult } from "../lib/optimize";

interface RequestMsg {
  id:    number;
  input: OptimizeInput;
}

interface ReplyOk  { id: number; ok: true;  result: OptimizeResult; }
interface ReplyErr { id: number; ok: false; error: string; }

self.onmessage = async (ev: MessageEvent<RequestMsg>) => {
  const { id, input } = ev.data;
  try {
    const result = await optimizeInventory(input);
    const reply: ReplyOk = { id, ok: true, result };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    const reply: ReplyErr = {
      id, ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(reply);
  }
};
