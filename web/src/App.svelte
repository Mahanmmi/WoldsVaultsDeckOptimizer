<script lang="ts">
  // Two-tab app: Optimize (run SA, view per-slot NDM, breakdown popup) and
  // Preview (assign concrete stat cards to scoring slots, view aggregate
  // player stats). Mirrors the workflow of src/gui.py.

  import { onMount } from "svelte";
  import {
    app, clearRunResult, clearPreviewAssignments, selectedCores,
  } from "./lib/state.svelte";
  import { loadConfigBundle, getMode } from "./lib/config";
  import { loadDecks } from "./lib/deck";
  import { CardClass } from "./lib/types";
  import { optimizeInventoryAsync } from "./lib/workerClient";
  import { loadModifiers } from "./lib/modifiers";
  import {
    isAssignableSlot, slotFamily, resetAssignmentsOnRun,
  } from "./lib/preview";
  import type { SlotBreakdown } from "./lib/breakdown";
  import type { Position, CardType } from "./lib/types";

  import ModeToggle       from "./components/ModeToggle.svelte";
  import DeckGrid         from "./components/DeckGrid.svelte";
  import InventoryTable   from "./components/InventoryTable.svelte";
  import CorePicker       from "./components/CorePicker.svelte";
  import Legend           from "./components/Legend.svelte";
  import BreakdownDialog  from "./components/BreakdownDialog.svelte";
  import AssignDialog     from "./components/AssignDialog.svelte";
  import StatsPanel       from "./components/StatsPanel.svelte";

  const baseUrl = (import.meta.env.BASE_URL ?? "/").endsWith("/")
    ? (import.meta.env.BASE_URL ?? "/")
    : (import.meta.env.BASE_URL ?? "/") + "/";

  // Dialog states — only one is open at a time (gated by `app.tab`).
  let breakdownOpen = $state(false);
  let breakdownPos:  Position | null      = $state(null);
  let breakdownBd:   SlotBreakdown | null = $state(null);

  let assignOpen = $state(false);
  let assignPos:  Position | null = $state(null);
  let assignSlotType: CardType | null = $state(null);
  let assignNdm = $state(0);

  // Per-slot NDM map for grid annotation.
  const perSlotNdm = $derived.by<Map<string, number> | null>(() => {
    if (!app.result) return null;
    const m = new Map<string, number>();
    for (const [k, b] of app.result.breakdown.perSlot) m.set(k, b.finalNdm);
    return m;
  });

  const VERIFY_TOL = 1e-6;

  onMount(async () => {
    try {
      const bundle = await loadConfigBundle(baseUrl);
      app.bundle = bundle;
      app.mode   = bundle.default_mode;
      app.cfg    = getMode(bundle, app.mode);
      app.decks  = await loadDecks(baseUrl, app.cfg.deckmod);
      app.deck   = app.decks[0] ?? null;
    } catch (e) {
      app.bootError = e instanceof Error ? e.message : String(e);
    }
    // Modifiers load is best-effort; preview just degrades if missing.
    try {
      app.modifiers = await loadModifiers(baseUrl);
    } catch (e) {
      app.modifiersError = e instanceof Error ? e.message : String(e);
    }
  });

  async function onModeChange(next: string) {
    if (!app.bundle) return;
    const prevName = app.deck?.name ?? null;
    app.cfg   = getMode(app.bundle, next);
    app.decks = await loadDecks(baseUrl, app.cfg.deckmod);
    app.deck  = (prevName && app.decks.find((d) => d.name === prevName)) || app.decks[0] || null;
    clearRunResult();
    clearPreviewAssignments();
  }

  function onDeckChange(e: Event) {
    const key = (e.currentTarget as HTMLSelectElement).value;
    app.deck = app.decks.find((d) => d.key === key) ?? app.deck;
    clearRunResult();
    clearPreviewAssignments();
  }

  function onClassChange(e: Event) {
    app.cardClass = (e.currentTarget as HTMLSelectElement).value as CardClass;
    clearRunResult();
    clearPreviewAssignments();
  }

  async function run() {
    if (!app.cfg || !app.deck || app.running) return;
    app.running = true;
    app.runError = null;
    app.result = null;
    app.elapsedMs = null;

    const t0 = performance.now();
    try {
      // $state.snapshot() unwraps Svelte 5 reactive proxies so structured-clone
      // can ship them across the worker boundary.
      const r = await optimizeInventoryAsync({
        deck:      $state.snapshot(app.deck),
        cardClass: app.cardClass,
        inventory: $state.snapshot(app.inventoryCounts),
        cores:     selectedCores(),
        nIter:     app.nIter,
        restarts:  app.restarts,
        cfg:       $state.snapshot(app.cfg),
      });
      app.result = r;

      // Migrate preview assignments to the new layout (drops orphans).
      if (app.modifiers) {
        const { kept } = resetAssignmentsOnRun(
          app.previewAssignments, app.result, app.cardClass, app.modifiers,
        );
        app.previewAssignments = kept;
      }
    } catch (e) {
      app.runError = e instanceof Error ? e.message : String(e);
    } finally {
      app.elapsedMs = performance.now() - t0;
      app.running   = false;
    }
  }

  // ─── Slot click dispatch — different action per tab ─────────────────────
  function onSlotClick(key: string, bd: SlotBreakdown) {
    const [r, c] = key.split(",").map(Number);
    const pos = [r, c] as Position;
    if (app.tab === "optimize") {
      breakdownPos  = pos;
      breakdownBd   = bd;
      breakdownOpen = true;
    } else {
      // Preview tab: only open the assign dialog on assignable, scoring slots.
      if (!isAssignableSlot(bd.cardType, app.cardClass)) return;
      assignPos      = pos;
      assignSlotType = bd.cardType;
      assignNdm      = bd.finalNdm;
      assignOpen     = true;
    }
  }
  function closeBreakdown() { breakdownOpen = false; breakdownPos = null; breakdownBd = null; }
  function closeAssign()    { assignOpen    = false; assignPos    = null; assignSlotType = null; }

  function assignCard(cardKey: string, tier: number) {
    if (!assignPos) return;
    const key = `${assignPos[0]},${assignPos[1]}`;
    const next = new Map(app.previewAssignments);
    next.set(key, { cardKey, tier });
    app.previewAssignments = next;
    closeAssign();
  }

  function clearAssignment() {
    if (!assignPos) return;
    const key = `${assignPos[0]},${assignPos[1]}`;
    const next = new Map(app.previewAssignments);
    next.delete(key);
    app.previewAssignments = next;
    closeAssign();
  }

  // Selected assignment for the open dialog (drives the "active tier" highlight).
  const currentAssignment = $derived.by(() => {
    if (!assignPos) return null;
    return app.previewAssignments.get(`${assignPos[0]},${assignPos[1]}`) ?? null;
  });

  // For the Preview tab, the dialog needs the family of the clicked slot.
  const dialogFamily = $derived(
    assignSlotType ? slotFamily(assignSlotType, app.cardClass) : null,
  );
</script>

<header class="app-header">
  <h1>Wold's Vaults — Deck Optimizer</h1>
  <div class="header-right">
    <nav class="tabs">
      <button type="button"
        class:active={app.tab === "optimize"}
        onclick={() => (app.tab = "optimize")}>Optimize</button>
      <button type="button"
        class:active={app.tab === "preview"}
        onclick={() => (app.tab = "preview")}>Preview</button>
    </nav>
    {#if app.bundle}
      <ModeToggle
        bind:mode={app.mode}
        modes={Object.keys(app.bundle.modes)}
        onChange={onModeChange}
      />
    {/if}
  </div>
</header>

{#if app.bootError}
  <div class="banner err">Boot failed: {app.bootError}</div>
{:else if !app.cfg || !app.deck}
  <div class="banner">Loading…</div>
{:else}
  <main class="layout">
    <!-- ── Left: controls (shared) ────────────────────────────────── -->
    <aside class="col-left">
      <section class="card">
        <h3>Deck</h3>
        <div class="row">
          <select value={app.deck.key} onchange={onDeckChange}>
            {#each app.decks as d}
              <option value={d.key}>{d.name}</option>
            {/each}
          </select>
        </div>
        <div class="row">
          <label>
            Class
            <select value={app.cardClass} onchange={onClassChange}>
              <option value={CardClass.SHINY}>Shiny</option>
              <option value={CardClass.EVO}>Evo</option>
            </select>
          </label>
        </div>
        <div class="meta">
          {app.deck.slots.length} slots · {app.deck.core_slots} cores · {app.deck.n_arcane} arcane
        </div>
      </section>

      {#if app.tab === "optimize"}
        <section class="card">
          <h3>SA params</h3>
          <div class="row">
            <label>Iterations
              <input type="number" min="1000" step="1000" bind:value={app.nIter} />
            </label>
          </div>
          <div class="row">
            <label>Restarts
              <input type="number" min="1" max="64" step="1" bind:value={app.restarts} />
            </label>
          </div>
          <button class="run" type="button" onclick={run} disabled={app.running}>
            {app.running ? "Optimizing…" : "Run"}
          </button>
          {#if app.runError}
            <div class="err small">{app.runError}</div>
          {/if}
        </section>

        <CorePicker />
      {/if}

      {#if app.tab === "preview"}
        <StatsPanel />
      {/if}
    </aside>

    <!-- ── Center: deck grid + result bar ─────────────────────────── -->
    <section class="col-center">
      {#if app.result && app.tab === "optimize"}
        {@const r = app.result}
        {@const delta = Math.abs(r.wasmScore - r.tsScore)}
        {@const ok = delta <= VERIFY_TOL}
        <div class="result-bar">
          <span class="score">NDM <strong>{r.wasmScore.toFixed(3)}</strong></span>
          <span class="badge" class:ok class:bad={!ok}>
            {ok
              ? `✓ WASM / TS agree (Δ ${delta.toExponential(2)})`
              : `✗ mismatch — WASM ${r.wasmScore.toFixed(3)} vs TS ${r.tsScore.toFixed(3)}`}
          </span>
          {#if app.elapsedMs !== null}
            <span class="time">{app.elapsedMs.toFixed(0)} ms</span>
          {/if}
          {#if r.coresUsed.length}
            <span class="cores">
              cores: {r.coresUsed.map((c) => c.color ? `${c.core_type}(${c.color})` : c.core_type).join(", ")}
            </span>
          {/if}
        </div>
      {/if}

      {#if app.tab === "preview" && !app.result}
        <div class="result-bar muted">
          Run the optimizer (Optimize tab) to produce a layout before assigning cards.
        </div>
      {/if}

      <DeckGrid
        deck={app.deck}
        assignment={app.result?.assignment ?? null}
        perSlotNdm={perSlotNdm}
        breakdown={app.result?.breakdown.perSlot ?? null}
        onSlotClick={onSlotClick}
      />

      <Legend />
    </section>

    <!-- ── Right: inventory (Optimize only) ───────────────────────── -->
    {#if app.tab === "optimize"}
      <aside class="col-right">
        <InventoryTable />
      </aside>
    {/if}
  </main>
{/if}

<BreakdownDialog
  open={breakdownOpen}
  pos={breakdownPos}
  bd={breakdownBd}
  onClose={closeBreakdown}
/>

<AssignDialog
  open={assignOpen}
  pos={assignPos}
  family={dialogFamily}
  ndm={assignNdm}
  modifiers={app.modifiers}
  current={currentAssignment}
  onAssign={assignCard}
  onClear={clearAssignment}
  onClose={closeAssign}
/>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #F4F5F7;
    color: #111827;
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 24px;
    background: #FFFFFF;
    border-bottom: 1px solid #E5E7EB;
  }
  .app-header h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .header-right { display: flex; align-items: center; gap: 14px; }

  .tabs { display: inline-flex; gap: 4px; }
  .tabs button {
    background: transparent;
    border: 0;
    padding: 6px 12px;
    font-size: 13px;
    color: #6B7280;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tabs button:hover { color: #111827; }
  .tabs button.active {
    color: #2563EB;
    border-bottom-color: #2563EB;
    font-weight: 600;
  }

  .banner {
    margin: 20px auto;
    max-width: 720px;
    padding: 12px 16px;
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    color: #4B5563;
    text-align: center;
  }
  .banner.err { color: #B91C1C; border-color: #FCA5A5; }

  .layout {
    display: grid;
    grid-template-columns: 280px 1fr 360px;
    gap: 16px;
    padding: 16px 24px;
    align-items: start;
  }
  @media (max-width: 1100px) {
    .layout { grid-template-columns: 1fr; }
  }

  .col-left, .col-right { display: flex; flex-direction: column; gap: 12px; }
  .col-center { display: flex; flex-direction: column; gap: 12px; align-items: stretch; }

  .card {
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    padding: 12px;
  }
  .card h3 {
    margin: 0 0 8px 0;
    font-size: 12px;
    text-transform: uppercase;
    color: #6B7280;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .row label { display: flex; flex-direction: column; gap: 4px; flex-grow: 1; font-size: 12px; color: #6B7280; }
  select, input[type="number"] {
    padding: 5px 7px;
    border: 1px solid #D1D5DB;
    border-radius: 4px;
    font-size: 13px;
    width: 100%;
  }
  .meta { font-size: 12px; color: #6B7280; margin-top: 4px; }

  .run {
    margin-top: 8px;
    width: 100%;
    padding: 8px 0;
    background: #2563EB;
    color: #FFFFFF;
    border: 0;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .run:disabled { opacity: .6; cursor: not-allowed; }
  .err { color: #B91C1C; }
  .err.small { font-size: 12px; margin-top: 6px; }

  .result-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    flex-wrap: wrap;
    font-size: 13px;
  }
  .result-bar.muted { color: #6B7280; font-style: italic; }
  .score strong { font-size: 16px; }
  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
  }
  .badge.ok  { background: #D1FAE5; color: #065F46; }
  .badge.bad { background: #FEE2E2; color: #991B1B; }
  .time  { color: #6B7280; font-family: 'JetBrains Mono', monospace; }
  .cores { color: #4B5563; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
</style>
