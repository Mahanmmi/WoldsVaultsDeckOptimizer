<script lang="ts">
  import { CardType } from "../lib/types";
  import { slotBg } from "../lib/palette";

  // Same grouping as `_build_legend` in src/gui.py.
  const positional: [string, string, CardType][] = [
    ["R", "Row",  CardType.ROW],
    ["C", "Col",  CardType.COL],
    ["S", "Surr", CardType.SURR],
    ["X", "Diag", CardType.DIAG],
  ];
  const other: [string, string, CardType][] = [
    ["D", "Deluxe",   CardType.DELUXE],
    ["T", "Typeless", CardType.TYPELESS],
    ["·", "Dead",     CardType.DEAD],
  ];
  const dirGreeds: [string, string, CardType][] = [
    ["↑", "Greed Up",    CardType.DIR_GREED_UP],
    ["↓", "Greed Down",  CardType.DIR_GREED_DOWN],
    ["←", "Greed Left",  CardType.DIR_GREED_LEFT],
    ["→", "Greed Right", CardType.DIR_GREED_RIGHT],
    ["↗", "Greed NE",    CardType.DIR_GREED_NE],
    ["↖", "Greed NW",    CardType.DIR_GREED_NW],
    ["↘", "Greed SE",    CardType.DIR_GREED_SE],
    ["↙", "Greed SW",    CardType.DIR_GREED_SW],
  ];
  const otherGreeds: [string, string, CardType][] = [
    ["e", "Evo Greed",  CardType.EVO_GREED],
    ["o", "Surr Greed", CardType.SURR_GREED],
  ];
  const entries = [...positional, ...other, ...dirGreeds, ...otherGreeds];
</script>

<div class="card">
  <h3>Card Key</h3>
  <div class="chips">
    {#each entries as [glyph, label, t]}
      <span class="chip" style:background={slotBg(t)}>
        <span class="glyph">{glyph}</span>
        <span class="label">{label}</span>
      </span>
    {/each}
  </div>

  <hr />

  <h3>How to use</h3>
  <ul>
    <li>Pick a deck and class, then enter how many of each (type, color) card you own
        in the inventory table. Use <em>Unlimited (100×)</em> for unconstrained testing
        or <em>Clear</em> to reset.</li>
    <li>Toggle the cores you own. The override field replaces the config default —
        for <code>PURE</code> and <code>DELUXE_CORE</code> it overrides only the
        scale term (formula stays <code>base + scale × n</code>).</li>
    <li>Hit <em>Run</em>. The deck repaints with the optimizer's chosen placement;
        each tile shows the card's symbol and its NDM contribution. Click any tile
        to see the full math (base × cores × boost) for that slot.</li>
    <li>The badge above the deck reports whether the WASM and TS re-score paths
        agree on the total. Green = agreement, red = mismatch.</li>
  </ul>
</div>

<style>
  .card {
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    padding: 12px;
  }
  h3 {
    font-size: 12px;
    text-transform: uppercase;
    color: #6B7280;
    margin: 0 0 8px 0;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid rgba(0,0,0,.08);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
  }
  .chip .glyph {
    font-family: 'JetBrains Mono', 'Consolas', monospace;
    font-weight: 600;
    font-size: 13px;
    min-width: 14px;
    text-align: center;
  }
  .chip .label { color: #1F2937; }
  hr { margin: 12px 0; border: 0; border-top: 1px solid #E5E7EB; }
  ul {
    margin: 0;
    padding-left: 1.1em;
    color: #4B5563;
    font-size: 12px;
    line-height: 1.5;
  }
  code { font-size: 11px; background: #F3F4F6; padding: 0 4px; border-radius: 3px; }
</style>
