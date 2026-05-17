<script lang="ts">
  import { app, setAllInventory } from "../lib/state.svelte";
  import { ALL_COLORS } from "../lib/types";
  import { INVENTORY_TYPES, TYPE_GLYPH, TYPE_LABEL, COLOR_HEX } from "../lib/palette";
  import { stackKey } from "../lib/optimize";

  // Stable list of all (type|color) keys this table covers — used by the
  // Unlimited/Clear presets to bulk-update without touching state directly.
  const allKeys = INVENTORY_TYPES.flatMap((t) =>
    ALL_COLORS.map((c) => stackKey(t, c)),
  );

  function valueFor(t: string, c: string): number {
    return app.inventoryCounts[stackKey(t, c)] ?? 0;
  }

  const MAX_COUNT = 100;

  // Browsers don't actually block typing values above `max` — they only flag
  // the input as :invalid on submit. We clamp here and rewrite the DOM
  // element so the visible text never goes above MAX_COUNT.
  function onInput(t: string, c: string, e: Event): void {
    const el = e.currentTarget as HTMLInputElement;
    const raw = Number(el.value);
    const clamped = Math.min(MAX_COUNT, Math.max(0, Math.floor(raw) || 0));
    if (String(clamped) !== el.value) el.value = String(clamped);
    app.inventoryCounts[stackKey(t, c)] = clamped;
  }

  /** Zero out every color for one card type. */
  function clearRow(t: string): void {
    for (const c of ALL_COLORS) app.inventoryCounts[stackKey(t, c)] = 0;
  }
</script>

<div class="card">
  <header class="card-head">
    <h3>Inventory</h3>
    <div class="btns">
      <button type="button" class="btn-flat primary" onclick={() => setAllInventory(100, allKeys)}>
        Unlimited (100×)
      </button>
      <button type="button" class="btn-flat" onclick={() => setAllInventory(0, allKeys)}>
        Clear
      </button>
    </div>
  </header>

  <div class="grid" style:grid-template-columns="100px repeat({ALL_COLORS.length}, 1fr) 28px">
    <div></div>
    {#each ALL_COLORS as c}
      <div class="dot-cell">
        <span class="dot" style:background={COLOR_HEX[c]}></span>
      </div>
    {/each}
    <div></div>

    {#each INVENTORY_TYPES as t}
      <div class="row-label">
        <span class="glyph">{TYPE_GLYPH[t]}</span>
        <span class="label">{TYPE_LABEL[t]}</span>
      </div>
      {#each ALL_COLORS as c}
        <input
          type="number"
          inputmode="numeric"
          min="0"
          max={MAX_COUNT}
          step="1"
          value={valueFor(t, c)}
          oninput={(e) => onInput(t, c, e)}
          onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        />
      {/each}
      <button
        type="button"
        class="row-clear"
        title="Clear {TYPE_LABEL[t]} row"
        aria-label="Clear {TYPE_LABEL[t]} row"
        onclick={() => clearRow(t)}
      >×</button>
    {/each}
  </div>
</div>

<style>
  .card {
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    padding: 12px;
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .card-head h3 {
    font-size: 12px;
    text-transform: uppercase;
    color: #6B7280;
    margin: 0;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .btns { display: flex; gap: 6px; }
  .btn-flat {
    background: transparent;
    border: 0;
    color: #6B7280;
    cursor: pointer;
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .btn-flat.primary { color: #2563EB; }
  .btn-flat:hover { background: #F3F4F6; }
  .grid {
    display: grid;
    gap: 6px;
    align-items: center;
  }
  .dot-cell { display: flex; justify-content: center; align-items: center; }
  .dot {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(0,0,0,.15);
  }
  .row-label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 4px;
  }
  .row-label .glyph {
    font-family: 'JetBrains Mono', monospace;
    width: 18px;
    text-align: center;
    color: #4B5563;
  }
  .row-label .label { font-size: 12px; }
  input[type="number"] {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 4px;
    border: 1px solid #D1D5DB;
    border-radius: 4px;
    font-size: 13px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"]:focus {
    outline: none;
    border-color: #2563EB;
    box-shadow: 0 0 0 2px rgba(37,99,235,.15);
  }
  .row-clear {
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    padding: 0;
    line-height: 1;
    border: 1px solid transparent;
    background: transparent;
    color: #9CA3AF;
    border-radius: 4px;
    font-size: 18px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .row-clear:hover {
    background: #FEE2E2;
    border-color: #FCA5A5;
    color: #B91C1C;
  }
</style>
