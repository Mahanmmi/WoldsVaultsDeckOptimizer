// High-level orchestrator: candidate-core enumeration + wasm SA dispatch +
// breakdown re-score. Mirrors `optimize_inventory` in src/inventory_optimize.py.

import init, { runSaInventory } from "../wasm/ndm_core";
import wasmUrl from "../wasm/ndm_core_bg.wasm?url";

import { type CardClass, type CoreSpec, type Placed } from "./types";
import type { Deck } from "./deck";
import type { ResolvedConfig } from "./config";
import { candidateCoresInventory } from "./cores";
import { simulateInventoryBreakdown, type BreakdownResult } from "./breakdown";

export interface InventoryCounts {
  // Map key = `${cardType}|${color}` so we can serialize across worker boundary.
  // Browser callers use the typed helper `setCount` to update.
  [stack: string]: number;
}

export function stackKey(t: string, c: string): string { return `${t}|${c}`; }
export function parseStackKey(k: string): [string, string] {
  const i = k.indexOf("|");
  return [k.slice(0, i), k.slice(i + 1)];
}

export interface OptimizeInput {
  deck:        Deck;
  cardClass:   CardClass;
  inventory:   InventoryCounts;
  cores:       CoreSpec[];           // user's available cores (CoreInventory)
  nIter:       number;
  restarts:    number;
  cfg:         ResolvedConfig;
}

export interface OptimizeResult {
  // Per-slot placed cards as a Map keyed by `${r},${c}`.
  assignment:  Map<string, Placed>;
  /** Best-combo NDM from the wasm SA — canonical (it's also what we re-score). */
  wasmScore:   number;
  /** TS-side re-score of the wasm assignment; should equal wasmScore within 1e-6. */
  tsScore:     number;
  coresUsed:   CoreSpec[];
  breakdown:   BreakdownResult;
}

let _wasmReady: Promise<void> | null = null;

/** Idempotent wasm boot. Browser & worker both call this lazily. */
export async function initWasm(): Promise<void> {
  if (_wasmReady) return _wasmReady;
  _wasmReady = init({ module_or_path: wasmUrl }).then(() => undefined);
  return _wasmReady;
}

/**
 * Run inventory-constrained SA across every viable core combo and return the
 * single best result. Calls wasm once per candidate combo; each call runs
 * `restarts` serial SA passes internally.
 */
export async function optimizeInventory(input: OptimizeInput): Promise<OptimizeResult> {
  await initWasm();
  const { deck, cardClass, inventory, cores, nIter, restarts, cfg } = input;

  // Inventory: [(type, color, count), ...] tuples for the wasm boundary.
  const invList: [string, string, number][] = [];
  for (const [k, n] of Object.entries(inventory)) {
    if (n <= 0) continue;
    const [t, c] = parseStackKey(k);
    invList.push([t, c, n]);
  }
  if (invList.length === 0) {
    throw new Error("Inventory is empty — set some card counts first.");
  }

  // Candidate core combos (TS port of candidate_cores_inventory).
  let candidates = candidateCoresInventory(
    cores, cardClass, deck.core_slots, deck.n_arcane, deck.slots.length, cfg,
  );
  if (candidates.length === 0) candidates = [[]];   // run with no cores

  // Pre-build the shared wasm payload (geometry + mults). Only `cores` changes
  // per combo, so we clone & patch that field each call.
  const basePayload = {
    slots:      deck.slots.map(([r, c]) => [r, c] as [number, number]),
    row_peers:  deck.rowPeers,
    col_peers:  deck.colPeers,
    surr_peers: deck.surrPeers,
    diag_peers: deck.diagPeers,
    n_arcane:   deck.n_arcane,
    is_shiny:   cardClass === "shiny",
    inventory:  invList,
    n_iter:     nIter,
    restarts:   restarts,

    mult_dir_vert:          cfg.greed.dir_vert,
    mult_dir_horiz:         cfg.greed.dir_horiz,
    mult_evo_greed:         cfg.greed.evo,
    mult_surr_greed:        cfg.greed.surr,
    mult_dir_diag_up:       cfg.greed.dir_diag_up,
    mult_dir_diag_down:     cfg.greed.dir_diag_down,
    mult_pure_base:         cfg.cores.pure_base,
    mult_pure_scale:        cfg.cores.pure_scale,
    mult_equilibrium:       cfg.cores.equilibrium,
    mult_foil:              cfg.cores.foil,
    mult_steadfast:         cfg.cores.steadfast,
    mult_color:             cfg.cores.color,
    mult_deluxe_flat:       cfg.deluxe.flat,
    mult_deluxe_core_base:  cfg.deluxe.core_base,
    mult_deluxe_core_scale: cfg.deluxe.core_scale,
    greed_additive:         cfg.stacking.greed_additive,
    additive_cores:         cfg.stacking.additive_cores,
  };

  let bestScore = -1;
  let bestAssign: [string, string][] = [];
  let bestCores: CoreSpec[] = [];

  for (const combo of candidates) {
    const corePayload: [string, string, number][] = combo.map((s) => [
      s.core_type,
      s.color ?? "",
      s.override === null ? -1.0 : s.override,
    ]);
    const out = runSaInventory({ ...basePayload, cores: corePayload }) as {
      assignment: [string, string][];
      score:      number;
    };
    if (out.score > bestScore) {
      bestScore  = out.score;
      bestAssign = out.assignment;
      bestCores  = combo;
    }
  }

  // Materialize the assignment as a Map<posKey, Placed> for the breakdown call.
  const asgnMap = new Map<string, Placed>();
  for (let i = 0; i < deck.slots.length; i++) {
    const [tStr, cStr] = bestAssign[i];
    asgnMap.set(
      `${deck.slots[i][0]},${deck.slots[i][1]}`,
      [tStr as any, (cStr ? cStr : null) as any],
    );
  }

  // Re-score in TS so we can cross-check + populate the per-slot breakdown.
  const breakdown = simulateInventoryBreakdown(deck, asgnMap, cardClass, bestCores, cfg);

  return {
    assignment: asgnMap,
    wasmScore:  bestScore,
    tsScore:    breakdown.total,
    coresUsed:  bestCores,
    breakdown,
  };
}
