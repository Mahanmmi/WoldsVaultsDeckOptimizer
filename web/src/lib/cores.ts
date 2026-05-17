// Core math + candidate-core enumeration (inventory-aware).
// Ports `_static_mult`, `_pure_mult`, `_deluxe_core_mult`, `_classify_cores`,
// and `candidate_cores_inventory` from src/inventory_optimize.py.

import { CardClass, CoreType, type Color, type CoreSpec } from "./types";
import type { ResolvedConfig } from "./config";

// ── Per-core multiplier lookups (override-aware) ─────────────────────────────

export function staticMult(spec: CoreSpec, cfg: ResolvedConfig): number {
  if (spec.override !== null) return spec.override;
  switch (spec.core_type) {
    case CoreType.EQUILIBRIUM: return cfg.cores.equilibrium;
    case CoreType.STEADFAST:   return cfg.cores.steadfast;
    case CoreType.COLOR:       return cfg.cores.color;
    case CoreType.FOIL:        return cfg.cores.foil;
    default:
      throw new Error(`staticMult called with non-static core ${spec.core_type}`);
  }
}

export function pureMult(spec: CoreSpec, n_ns: number, cfg: ResolvedConfig): number {
  const scale = spec.override !== null ? spec.override : cfg.cores.pure_scale;
  return cfg.cores.pure_base + scale * n_ns;
}

export function deluxeCoreMult(spec: CoreSpec, n_deluxe: number, cfg: ResolvedConfig): number {
  const scale = spec.override !== null ? spec.override : cfg.deluxe.core_scale;
  return cfg.deluxe.core_base + scale * n_deluxe;
}

// ── Classified-core output (for breakdown re-score) ───────────────────────────

export interface CoreComponent {
  core_type: CoreType;
  color:     Color | null;     // only set for COLOR cores
  value:     number;
  override:  boolean;
}

export interface ExcludedCore {
  core_type: CoreType;
  color:     Color | null;
  reason:    string;
}

/** Mirror `_classify_cores`: split cores into baseline / color / deluxe / excluded. */
export function classifyCores(
  cores:      readonly CoreSpec[],
  card_class: CardClass,
  n_ns:       number,
  n_deluxe:   number,
  n_arcane:   number,
  cfg:        ResolvedConfig,
): { baseline: CoreComponent[]; colorComp: CoreComponent | null; deluxeComp: CoreComponent | null; classExcluded: ExcludedCore[] } {
  const baseline: CoreComponent[] = [];
  let colorComp: CoreComponent | null = null;
  let deluxeComp: CoreComponent | null = null;
  const classExcluded: ExcludedCore[] = [];

  for (const spec of cores) {
    const isOverride = spec.override !== null;
    switch (spec.core_type) {
      case CoreType.PURE: {
        const v = pureMult(spec, n_ns + n_arcane, cfg);
        baseline.push({ core_type: CoreType.PURE, color: null, value: v, override: isOverride });
        break;
      }
      case CoreType.EQUILIBRIUM:
        if (card_class === CardClass.SHINY) {
          baseline.push({ core_type: CoreType.EQUILIBRIUM, color: null, value: staticMult(spec, cfg), override: isOverride });
        } else {
          classExcluded.push({ core_type: CoreType.EQUILIBRIUM, color: null,
            reason: "equilibrium only applies to SHINY decks (this run is EVO)" });
        }
        break;
      case CoreType.STEADFAST:
        if (card_class === CardClass.SHINY) {
          baseline.push({ core_type: CoreType.STEADFAST, color: null, value: staticMult(spec, cfg), override: isOverride });
        } else {
          classExcluded.push({ core_type: CoreType.STEADFAST, color: null,
            reason: "steadfast only applies to SHINY decks (this run is EVO)" });
        }
        break;
      case CoreType.FOIL:
        baseline.push({ core_type: CoreType.FOIL, color: null, value: staticMult(spec, cfg), override: isOverride });
        break;
      case CoreType.COLOR:
        colorComp = { core_type: CoreType.COLOR, color: spec.color, value: staticMult(spec, cfg), override: isOverride };
        break;
      case CoreType.DELUXE_CORE: {
        const v = deluxeCoreMult(spec, n_deluxe, cfg);
        deluxeComp = { core_type: CoreType.DELUXE_CORE, color: null, value: v, override: isOverride };
        break;
      }
    }
  }
  return { baseline, colorComp, deluxeComp, classExcluded };
}

// ── Set-like dedup for CoreSpec collections ──────────────────────────────────
// CoreSpec is a structural type; we key on (core_type|color|override) for set
// semantics. Frozensets aren't a thing in JS, so we hash to a string key.

export function coreSpecKey(s: CoreSpec): string {
  return `${s.core_type}|${s.color ?? ""}|${s.override === null ? "_" : s.override}`;
}

function comboKey(combo: readonly CoreSpec[]): string {
  return combo.map(coreSpecKey).sort().join(";");
}

// ── Candidate cores enumeration (inventory-aware) ────────────────────────────
//
// Port of candidate_cores_inventory() in src/inventory_optimize.py. Same
// SHINY / EVO grouping, color-core enumeration, and inventory restriction.

function combinations<T>(arr: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > arr.length) return [];
  const out: T[][] = [];
  const recur = (start: number, acc: T[]) => {
    if (acc.length === size) { out.push(acc.slice()); return; }
    for (let i = start; i <= arr.length - (size - acc.length); i++) {
      acc.push(arr[i]);
      recur(i + 1, acc);
      acc.pop();
    }
  };
  recur(0, []);
  return out;
}

export function candidateCoresInventory(
  available:   readonly CoreSpec[],
  card_class:  CardClass,
  core_slots:  number,
  n_arcane:    number,
  deck_n_slots: number,
  cfg:         ResolvedConfig,
): CoreSpec[][] {
  const k = core_slots;
  const byType = new Map<CoreType, CoreSpec[]>();
  for (const spec of available) {
    const bucket = byType.get(spec.core_type) ?? [];
    bucket.push(spec);
    byType.set(spec.core_type, bucket);
  }

  const pureSpec       = byType.get(CoreType.PURE)?.[0]        ?? null;
  const deluxeCoreSpec = byType.get(CoreType.DELUXE_CORE)?.[0] ?? null;
  const foilSpec       = byType.get(CoreType.FOIL)?.[0]        ?? null;
  const equiSpec       = byType.get(CoreType.EQUILIBRIUM)?.[0] ?? null;
  const steadSpec      = byType.get(CoreType.STEADFAST)?.[0]   ?? null;
  const colorSpecs     = byType.get(CoreType.COLOR)            ?? [];

  const colorChoices: (CoreSpec | null)[] = [null, ...colorSpecs];

  const candidates: CoreSpec[][] = [];
  const seen = new Set<string>();
  const add = (combo: CoreSpec[]) => {
    const key = comboKey(combo);
    if (!seen.has(key)) { seen.add(key); candidates.push(combo); }
  };

  // Union-by-key (avoids duplicates when fillers re-pick color_pick).
  const unionUnique = (a: readonly CoreSpec[], b: readonly CoreSpec[]): CoreSpec[] => {
    const keys = new Set<string>();
    const out: CoreSpec[] = [];
    for (const x of [...a, ...b]) {
      const k = coreSpecKey(x);
      if (!keys.has(k)) { keys.add(k); out.push(x); }
    }
    return out;
  };

  // ── SHINY ───────────────────────────────────────────────────────────────
  if (card_class === CardClass.SHINY) {
    const nonVarStatic: CoreSpec[] = [equiSpec, steadSpec, foilSpec].filter((s): s is CoreSpec => s !== null);

    const bestShinyFillers = (slotsLeft: number, colorPick: CoreSpec | null): CoreSpec[] => {
      const pool: CoreSpec[] = [...nonVarStatic];
      if (colorPick !== null) pool.push(colorPick);
      const cap = Math.min(slotsLeft, pool.length);
      let bestM = 0.0;
      let bestC: CoreSpec[] = [];
      for (let size = 0; size <= cap; size++) {
        for (const combo of combinations(pool, size)) {
          let m = 1.0;
          for (const c of combo) m *= staticMult(c, cfg);
          if (m > bestM) { bestM = m; bestC = combo; }
        }
      }
      return bestC;
    };

    const varPool: CoreSpec[] = [];
    if (pureSpec)       varPool.push(pureSpec);
    if (deluxeCoreSpec) varPool.push(deluxeCoreSpec);

    for (const colorPick of colorChoices) {
      for (let size = 0; size <= varPool.length; size++) {
        for (const varCombo of combinations(varPool, size)) {
          const pre: CoreSpec[] = [...varCombo];
          if (colorPick !== null) pre.push(colorPick);
          const preKeys = new Set(pre.map(coreSpecKey));
          if (preKeys.size > k) continue;
          const fillers = bestShinyFillers(k - preKeys.size, colorPick);
          add(unionUnique(pre, fillers));
        }
      }
    }
    return candidates;
  }

  // ── EVO ─────────────────────────────────────────────────────────────────
  const n_ns_full = deck_n_slots + n_arcane;

  const evoNoFoilStaticMult = (spec: CoreSpec): number => {
    if (spec.core_type === CoreType.PURE) return pureMult(spec, n_ns_full, cfg);
    return staticMult(spec, cfg);
  };

  const bestFixedEvoNoFoil = (slotsLeft: number, colorPick: CoreSpec | null): CoreSpec[] => {
    const pool: CoreSpec[] = [];
    if (pureSpec)   pool.push(pureSpec);
    if (colorPick)  pool.push(colorPick);
    const cap = Math.min(slotsLeft, pool.length);
    let bestM = -1.0;
    let bestC: CoreSpec[] = [];
    for (let size = 0; size <= cap; size++) {
      for (const combo of combinations(pool, size)) {
        let m = 1.0;
        for (const c of combo) m *= evoNoFoilStaticMult(c);
        if (m > bestM) { bestM = m; bestC = combo; }
      }
    }
    return bestC;
  };

  const bestFixedEvoWithFoil = (slotsLeft: number, colorPick: CoreSpec | null): CoreSpec[] => {
    if (slotsLeft >= 1 && colorPick !== null && staticMult(colorPick, cfg) > 1.0) {
      return [colorPick];
    }
    return [];
  };

  const deluxeVar: CoreSpec[] = deluxeCoreSpec ? [deluxeCoreSpec] : [];

  // Group A: no FOIL (PURE is static)
  for (const colorPick of colorChoices) {
    for (let size = 0; size <= deluxeVar.length; size++) {
      for (const varCombo of combinations(deluxeVar, size)) {
        const pre: CoreSpec[] = [...varCombo];
        if (colorPick !== null) pre.push(colorPick);
        const preKeys = new Set(pre.map(coreSpecKey));
        if (preKeys.size > k) continue;
        const fillers = bestFixedEvoNoFoil(k - preKeys.size, colorPick);
        add(unionUnique(pre, fillers));
      }
    }
  }

  // Group B: with FOIL (PURE is variable)
  if (foilSpec) {
    const varPoolB: CoreSpec[] = [];
    if (pureSpec)       varPoolB.push(pureSpec);
    if (deluxeCoreSpec) varPoolB.push(deluxeCoreSpec);

    for (const colorPick of colorChoices) {
      for (let size = 0; size <= varPoolB.length; size++) {
        for (const varCombo of combinations(varPoolB, size)) {
          const pre: CoreSpec[] = [...varCombo, foilSpec];
          if (colorPick !== null) pre.push(colorPick);
          const preKeys = new Set(pre.map(coreSpecKey));
          if (preKeys.size > k) continue;
          const fillers = bestFixedEvoWithFoil(k - preKeys.size, colorPick);
          add(unionUnique(pre, fillers));
        }
      }
    }
  }

  return candidates;
}
