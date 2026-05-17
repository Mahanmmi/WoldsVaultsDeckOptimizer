// Deck geometry — port of src/config.py's Deck class.
// Loads from the build-time-generated `public/decks.json` and precomputes
// the row / col / surr / diag peer sets (same shape as the Python optimizer
// passes to ndm_core::run_sa_inventory).

import type { Position } from "./types";

export interface RawDeck {
  key:             string;
  name:            string;
  slots:           [number, number][];   // JSON: array of [row, col] pairs
  base_core_slots: number;               // add ``modes.<mode>.deckmod`` for final
  n_arcane:        number;
  min_regular:     number;
  max_greed:       number;
}

export interface Deck {
  key:        string;
  name:       string;
  slots:      Position[];                // ordering is canonical for the Rust call
  core_slots: number;                    // base + mode's deckmod
  n_arcane:   number;
  min_regular: number;
  max_greed:   number;

  // Peer-index arrays (indices into `slots`), parallel to Rust `DeckGeom`.
  rowPeers:  number[][];
  colPeers:  number[][];
  surrPeers: number[][];
  diagPeers: number[][];
}

function posKey(r: number, c: number): string {
  return `${r},${c}`;
}

/** Build a Deck (with precomputed peers) from a RawDeck and the active mode's deckmod. */
export function buildDeck(raw: RawDeck, deckmod: number): Deck {
  const slots: Position[] = raw.slots.map(([r, c]) => [r, c] as const);
  const n = slots.length;
  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    index.set(posKey(slots[i][0], slots[i][1]), i);
  }

  const rowPeers:  number[][] = [];
  const colPeers:  number[][] = [];
  const surrPeers: number[][] = [];
  const diagPeers: number[][] = [];

  for (let i = 0; i < n; i++) {
    const [r, c] = slots[i];
    const row: number[] = [], col: number[] = [], sur: number[] = [], dia: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const [qr, qc] = slots[j];
      if (qr === r) row.push(j);
      if (qc === c) col.push(j);
      if (Math.max(Math.abs(qr - r), Math.abs(qc - c)) <= 1) sur.push(j);
      // Same diagonal as Python: NW-SE  (q.r - q.c == r - c)  OR  NE-SW (q.r + q.c == r + c)
      if (qr - qc === r - c || qr + qc === r + c) dia.push(j);
    }
    rowPeers.push(row);
    colPeers.push(col);
    surrPeers.push(sur);
    diagPeers.push(dia);
  }

  return {
    key:         raw.key,
    name:        raw.name,
    slots,
    core_slots:  raw.base_core_slots + deckmod,
    n_arcane:    raw.n_arcane,
    min_regular: raw.min_regular,
    max_greed:   raw.max_greed,
    rowPeers, colPeers, surrPeers, diagPeers,
  };
}

/** Fetch the build-time deck bundle and build Deck objects for the active mode. */
export async function loadDecks(baseUrl: string, deckmod: number): Promise<Deck[]> {
  const res = await fetch(`${baseUrl}decks.json`);
  if (!res.ok) throw new Error(`Failed to load decks.json: ${res.status}`);
  const raw: RawDeck[] = await res.json();
  return raw.map((r) => buildDeck(r, deckmod));
}
