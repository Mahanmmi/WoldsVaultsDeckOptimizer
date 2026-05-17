<script lang="ts">
  interface Props {
    mode:    string;
    modes:   string[];
    onChange?: (next: string) => void;
  }
  let { mode = $bindable(), modes, onChange }: Props = $props();

  function pick(next: string) {
    if (next === mode) return;
    mode = next;
    onChange?.(next);
  }
</script>

<div class="seg">
  {#each modes as m}
    <button
      type="button"
      class="seg-btn"
      class:active={m === mode}
      onclick={() => pick(m)}
    >
      {m}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    border: 1px solid #D1D5DB;
    border-radius: 6px;
    overflow: hidden;
    background: #FFFFFF;
  }
  .seg-btn {
    background: transparent;
    border: 0;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
    text-transform: capitalize;
    color: #374151;
  }
  .seg-btn + .seg-btn { border-left: 1px solid #E5E7EB; }
  .seg-btn:hover { background: #F3F4F6; }
  .seg-btn.active {
    background: #2563EB;
    color: #FFFFFF;
  }
</style>
