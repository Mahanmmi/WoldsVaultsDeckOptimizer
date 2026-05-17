<script lang="ts">
  import type { SlotBreakdown } from "../lib/breakdown";
  import type { Position } from "../lib/types";
  import { formatBreakdown } from "../lib/formatBreakdown";

  interface Props {
    open: boolean;
    pos:  Position | null;
    bd:   SlotBreakdown | null;
    onClose: () => void;
  }
  let { open, pos, bd, onClose }: Props = $props();

  const text = $derived(open && pos && bd ? formatBreakdown(pos, bd) : "");

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Slot breakdown"
    tabindex="-1"
    onclick={onBackdropClick}
  >
    <div class="modal">
      <header>
        <strong>Slot breakdown</strong>
        <button type="button" class="close" onclick={onClose} aria-label="Close">×</button>
      </header>
      <pre>{text}</pre>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(15,23,42,.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 100;
  }
  .modal {
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    box-shadow: 0 12px 24px rgba(0,0,0,.18);
    min-width: 360px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid #E5E7EB;
  }
  .close {
    background: transparent;
    border: 0;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    color: #6B7280;
    padding: 0 6px;
  }
  .close:hover { color: #111827; }
  pre {
    margin: 0;
    padding: 12px;
    overflow: auto;
    font-family: 'JetBrains Mono', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.4;
    color: #111827;
    white-space: pre;
  }
</style>
