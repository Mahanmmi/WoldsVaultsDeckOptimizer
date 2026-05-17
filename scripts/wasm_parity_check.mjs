// End-to-end parity check: run the same fixed inventory through the
// nodejs-target wasm build and compare against the Python optimizer.
//
// Usage:  node scripts/wasm_parity_check.mjs
//
// Requires that `wasm-pack build --target nodejs --out-dir web/src/wasm-node`
// has been run beforehand (it has, as part of Phase 4).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runSaInventory } from "../web/src/wasm-node/ndm_core.js";

const HERE  = dirname(fileURLToPath(import.meta.url));
const ROOT  = dirname(HERE);
const CONF  = join(ROOT, "web", "public", "config.json");
const DECKS = join(ROOT, "web", "public", "decks.json");

const cfgBundle = JSON.parse(await readFile(CONF, "utf-8"));
const decks     = JSON.parse(await readFile(DECKS, "utf-8"));
const cfg       = cfgBundle.modes[cfgBundle.default_mode];

const deck = decks.find((d) => d.key === "moon");
if (!deck) throw new Error("Moon deck missing from decks.json");

// Build peer index arrays (same logic as web/src/lib/deck.ts).
const slots = deck.slots.map(([r, c]) => [r, c]);
const n     = slots.length;
const idx   = new Map(slots.map(([r, c], i) => [`${r},${c}`, i]));

const rowPeers = [], colPeers = [], surrPeers = [], diagPeers = [];
for (let i = 0; i < n; i++) {
  const [r, c] = slots[i];
  const row = [], col = [], sur = [], dia = [];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const [qr, qc] = slots[j];
    if (qr === r) row.push(j);
    if (qc === c) col.push(j);
    if (Math.max(Math.abs(qr - r), Math.abs(qc - c)) <= 1) sur.push(j);
    if (qr - qc === r - c || qr + qc === r + c) dia.push(j);
  }
  rowPeers.push(row); colPeers.push(col); surrPeers.push(sur); diagPeers.push(dia);
}

// Same inventory as the Rust+Python smoke test we ran in Phase 1.
const inventory = [
  ["row",          "red",    5],
  ["col",          "blue",   5],
  ["surr",         "green",  5],
  ["diag",         "yellow", 5],
  ["dir_greed_up", "red",    3],
  ["typeless",     "blue",   3],
];

const payload = {
  slots, row_peers: rowPeers, col_peers: colPeers,
  surr_peers: surrPeers, diag_peers: diagPeers,
  n_arcane: deck.n_arcane,
  is_shiny: true,
  inventory,
  cores: [],                       // no cores
  n_iter: 60_000,
  restarts: 12,

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

const t0 = performance.now();
const res = runSaInventory(payload);
const elapsed = performance.now() - t0;

console.log(`Deck: ${deck.name}   slots: ${n}   mode: ${cfgBundle.default_mode}`);
console.log(`WASM (Node) score: ${res.score.toFixed(4)}`);
console.log(`Elapsed: ${elapsed.toFixed(1)} ms`);
// Production-iter/restart Python (PyO3 → parallel rayon) deterministically
// converges to 152.00 on this fixture. The wasm path runs restarts serially
// but should still find the same optimum given enough iterations.
const EXPECTED = 152.0;
console.log(`Expected: ${EXPECTED.toFixed(2)}`);
console.log(
  `Parity: ${Math.abs(res.score - EXPECTED) < 1e-6 ? "✓ MATCH" : "✗ MISMATCH (SA didn't converge — try more restarts/iter)"}`
);
process.exit(Math.abs(res.score - EXPECTED) < 1e-6 ? 0 : 1);
