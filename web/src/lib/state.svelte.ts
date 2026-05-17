// App-wide reactive state (Svelte 5 runes). One module-level store; the
// components read/mutate fields on `app`. Mirrors the `_AppState` dataclass
// in src/gui.py plus the parts we keep purely client-side (no shutdown).

import { CardClass, type CoreSpec } from "./types";
import type { Deck } from "./deck";
import type { ResolvedConfig, ConfigBundle } from "./config";
import type { OptimizeResult } from "./optimize";
import { CORE_OPTIONS } from "./coreOptions";
import type { CardEntry } from "./modifiers";
import type { AssignmentKey, AssignmentVal } from "./preview";

export type Tab = "optimize" | "preview";

export interface CoreRowState {
  enabled:  boolean;
  override: number | null;
}

interface AppState {
  // Boot
  bundle: ConfigBundle | null;
  mode: string;
  cfg: ResolvedConfig | null;
  decks: Deck[];
  bootError: string | null;

  // Selection
  deck: Deck | null;
  cardClass: CardClass;

  // Inputs
  inventoryCounts: Record<string, number>;            // stackKey -> count
  coreState: CoreRowState[];                          // index aligned with CORE_OPTIONS
  nIter: number;
  restarts: number;

  // Run
  running: boolean;
  result: OptimizeResult | null;
  elapsedMs: number | null;
  runError: string | null;

  // Tabs / Preview
  tab: Tab;
  modifiers: Map<string, CardEntry> | null;
  modifiersError: string | null;
  previewAssignments: Map<AssignmentKey, AssignmentVal>;
}

function initialCoreState(): CoreRowState[] {
  return CORE_OPTIONS.map(() => ({ enabled: false, override: null }));
}

export const app = $state<AppState>({
  bundle: null,
  mode: "wolds",
  cfg: null,
  decks: [],
  bootError: null,

  deck: null,
  cardClass: CardClass.SHINY,

  inventoryCounts: {},
  coreState: initialCoreState(),
  nIter: 60_000,
  restarts: 12,

  running: false,
  result: null,
  elapsedMs: null,
  runError: null,

  tab: "optimize",
  modifiers: null,
  modifiersError: null,
  previewAssignments: new Map(),
});

/** Build the user's CoreSpec[] from the picker state. */
export function selectedCores(): CoreSpec[] {
  const out: CoreSpec[] = [];
  for (let i = 0; i < CORE_OPTIONS.length; i++) {
    const s = app.coreState[i];
    if (!s.enabled) continue;
    out.push({
      core_type: CORE_OPTIONS[i].coreType,
      color:     CORE_OPTIONS[i].color,
      override:  s.override,
    });
  }
  return out;
}

/** Apply a flat preset to every inventory cell (Unlimited / Clear buttons). */
export function setAllInventory(value: number, allKeys: string[]): void {
  for (const k of allKeys) app.inventoryCounts[k] = value;
}

/** Toggle every core checkbox at once (Enable-all / Disable-all). */
export function setAllCores(enabled: boolean): void {
  for (const s of app.coreState) s.enabled = enabled;
}

/** Reset run-derived state when the deck / mode / class changes. */
export function clearRunResult(): void {
  app.result    = null;
  app.elapsedMs = null;
  app.runError  = null;
}

/** Drop every preview-mode assignment (deck/class swap, manual clear). */
export function clearPreviewAssignments(): void {
  app.previewAssignments = new Map();
}
