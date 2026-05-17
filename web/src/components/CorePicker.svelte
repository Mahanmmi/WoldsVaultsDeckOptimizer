<script lang="ts">
  import { app, setAllCores } from "../lib/state.svelte";
  import { CORE_OPTIONS, coreLabel } from "../lib/coreOptions";

  function setOverride(i: number, raw: string): void {
    const v = raw.trim();
    app.coreState[i].override = v === "" ? null : Number(v);
  }
</script>

<div class="card">
  <header class="card-head">
    <h3>Cores</h3>
    <div class="btns">
      <button type="button" class="btn-flat primary" onclick={() => setAllCores(true)}>Enable all</button>
      <button type="button" class="btn-flat" onclick={() => setAllCores(false)}>Disable all</button>
    </div>
  </header>

  {#each CORE_OPTIONS as opt, i}
    <div class="row">
      <label class="check">
        <input type="checkbox" bind:checked={app.coreState[i].enabled} />
        <span>{coreLabel(opt)}</span>
      </label>
      <input
        type="number"
        class="override"
        step="0.05"
        placeholder="override"
        value={app.coreState[i].override ?? ""}
        oninput={(e) => setOverride(i, (e.currentTarget as HTMLInputElement).value)}
      />
    </div>
  {/each}
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
    cursor: pointer;
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 4px;
    color: #6B7280;
  }
  .btn-flat.primary { color: #2563EB; }
  .btn-flat:hover { background: #F3F4F6; }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-grow: 1;
    font-size: 13px;
    cursor: pointer;
  }
  .override {
    width: 100px;
    padding: 4px 6px;
    border: 1px solid #D1D5DB;
    border-radius: 4px;
    font-size: 13px;
    text-align: right;
  }
</style>
