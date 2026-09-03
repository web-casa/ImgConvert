<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import Archive from "@lucide/svelte/icons/archive";
  import CircleStop from "@lucide/svelte/icons/circle-stop";
  import Download from "@lucide/svelte/icons/download";
  import FolderDown from "@lucide/svelte/icons/folder-down";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

  import type { BatchExportPlan, BatchExportUiState } from "./batch-export";
  import type { Copy } from "./workbench";

  let {
    copy,
    numberLocale,
    plan,
    directorySupported,
    batchRunning,
    state,
    progressCompleted,
    progressTotal,
    onSaveDirectory,
    onDownloadArchive,
    onCancel,
  }: {
    copy: Copy;
    numberLocale: string;
    plan: BatchExportPlan;
    directorySupported: boolean;
    batchRunning: boolean;
    state: BatchExportUiState;
    progressCompleted: number;
    progressTotal: number;
    onSaveDirectory: () => void;
    onDownloadArchive: () => void;
    onCancel: () => void;
  } = $props();

  const busy = $derived(state === "archiving" || state === "writing");
  const progressPercent = $derived(
    progressTotal > 0 ? Math.min(100, Math.round((progressCompleted / progressTotal) * 100)) : 0,
  );
  const formatList = $derived(plan.outputFormats.map((format) => format.toUpperCase()).join(" · "));

  function count(template: string, value: number): string {
    return template.replace("{count}", new Intl.NumberFormat(numberLocale).format(value));
  }

  function formatBytes(bytes: number): string {
    const formatter = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 });
    if (bytes < 1024) return `${formatter.format(bytes)}\u00a0B`;
    if (bytes < 1024 * 1024) return `${formatter.format(bytes / 1024)}\u00a0KB`;
    return `${formatter.format(bytes / (1024 * 1024))}\u00a0MB`;
  }

  function stateMessage(): string {
    if (state === "archive-complete") return copy.batch.archiveComplete;
    if (state === "archive-error") return copy.batch.archiveError;
    if (state === "cancelled") return copy.batch.cancelled;
    if (state === "directory-complete") {
      return count(copy.batch.directoryComplete, plan.outputCount);
    }
    if (state === "directory-error") return copy.batch.directoryError;
    if (state === "archiving") return copy.batch.archiving;
    if (state === "writing") return copy.batch.writing;
    return "";
  }
</script>

<section class="batch-export" aria-labelledby="batch-export-title">
  <div class="batch-export-icon"><Archive size={21} aria-hidden="true" /></div>
  <div class="batch-export-copy">
    <p class="batch-eyebrow">{copy.batch.eyebrow}</p>
    <h2 id="batch-export-title">{copy.batch.title}</h2>
    <p class="batch-description">{copy.batch.body}</p>
    <div class="batch-facts" aria-label={copy.batch.summary}>
      <span>{count(copy.batch.outputCount, plan.outputCount)}</span>
      <span translate="no">{formatList}</span>
      <span>{copy.batch.estimatedZip} {formatBytes(plan.estimatedArchiveBytes)}</span>
      {#if plan.failureCount > 0}
        <span class="failure-fact"
          >{count(copy.batch.failureCount, plan.failureCount)} · {copy.batch.failureReport}</span
        >
      {/if}
    </div>

    {#if !plan.archiveAllowed}
      <p class="batch-warning" role="alert">
        <TriangleAlert size={16} aria-hidden="true" />
        <span>{copy.batch.tooLarge}</span>
        {#if !directorySupported}<a href="/#download">{copy.batch.useDesktop}</a>{/if}
      </p>
    {:else if !directorySupported}
      <p class="batch-note">
        <ShieldCheck size={15} aria-hidden="true" />{copy.batch.folderUnavailable}
      </p>
    {/if}

    {#if busy}
      <div class="batch-progress" role="status" aria-live="polite">
        <div>
          <span>{stateMessage()}</span><span>{progressPercent}%</span>
        </div>
        <progress max="100" value={progressPercent} aria-label={stateMessage()}></progress>
      </div>
    {:else if state !== "idle"}
      <p
        class:error-state={state === "archive-error" || state === "directory-error"}
        class="batch-state"
        role={state === "archive-error" || state === "directory-error" ? "alert" : "status"}
      >
        {stateMessage()}
      </p>
    {/if}
  </div>

  <div class="batch-actions">
    {#if busy}
      <button class="cancel-export" type="button" onclick={onCancel}>
        <CircleStop size={17} aria-hidden="true" />{copy.batch.cancel}
      </button>
    {:else}
      {#if directorySupported}
        <button
          class="folder-action"
          type="button"
          disabled={batchRunning}
          aria-label={`${copy.batch.saveFolder}, ${copy.batch.recommended}`}
          onclick={onSaveDirectory}
        >
          <FolderDown size={17} aria-hidden="true" />
          <span>{copy.batch.saveFolder}</span>
          <small aria-hidden="true">{copy.batch.recommended}</small>
        </button>
      {/if}
      <button
        class:primary-fallback={!directorySupported}
        type="button"
        disabled={batchRunning || !plan.archiveAllowed}
        onclick={onDownloadArchive}
      >
        <Download size={17} aria-hidden="true" />{copy.batch.downloadZip}
      </button>
    {/if}
  </div>
</section>

<style>
  .batch-export {
    display: grid;
    min-width: 0;
    align-items: start;
    gap: 14px;
    margin-top: 22px;
    border: 1px solid color-mix(in srgb, var(--yellow) 48%, var(--line));
    border-radius: 18px;
    padding: 17px;
    background: var(--yellow-soft);
    box-shadow: 0 12px 32px rgb(54 70 47 / 8%);
    grid-template-columns: 44px minmax(0, 1fr) auto;
  }

  .batch-export-icon {
    display: grid;
    width: 44px;
    height: 44px;
    border: 1px solid color-mix(in srgb, var(--green) 34%, transparent);
    border-radius: 13px;
    background: var(--green-soft);
    color: var(--green-deep);
    place-items: center;
  }

  .batch-export-copy {
    display: grid;
    min-width: 0;
    gap: 6px;
  }

  .batch-eyebrow {
    color: var(--green-deep);
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.62rem;
    font-weight: 760;
    letter-spacing: 0.12em;
  }

  h2 {
    font-size: 1rem;
    letter-spacing: -0.025em;
  }

  .batch-description {
    max-width: 62ch;
    color: var(--ink-soft);
    font-size: 0.76rem;
    line-height: 1.5;
  }

  .batch-facts {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .batch-facts span {
    overflow-wrap: anywhere;
    border: 1px solid color-mix(in srgb, var(--ink) 11%, transparent);
    border-radius: 999px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--paper-raised) 68%, transparent);
    color: var(--ink-soft);
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.61rem;
    font-variant-numeric: tabular-nums;
  }

  .batch-facts .failure-fact {
    border-color: color-mix(in srgb, var(--red) 24%, transparent);
    color: var(--red);
  }

  .batch-actions {
    display: grid;
    min-width: 156px;
    gap: 8px;
  }

  .batch-actions button {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid color-mix(in srgb, var(--green) 32%, var(--line));
    border-radius: 12px;
    padding: 0 13px;
    background: var(--paper-raised);
    color: var(--green-deep);
    font-size: 0.72rem;
    font-weight: 740;
    transition:
      border-color 140ms ease,
      background-color 140ms ease,
      transform 140ms ease;
  }

  .batch-actions button:hover:not(:disabled) {
    border-color: var(--green);
    background: var(--green-soft);
    transform: translateY(-1px);
  }

  .batch-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .batch-actions .folder-action,
  .batch-actions .primary-fallback {
    border-color: var(--green-deep);
    background: var(--green-deep);
    color: var(--paper-raised);
  }

  .folder-action {
    position: relative;
    padding-right: 70px !important;
  }

  .folder-action small {
    position: absolute;
    right: 7px;
    border-radius: 999px;
    padding: 3px 6px;
    background: var(--yellow-soft);
    color: var(--ink);
    font-size: 0.55rem;
    line-height: 1;
  }

  .batch-actions .cancel-export {
    border-color: color-mix(in srgb, var(--red) 40%, var(--line));
    background: var(--red-soft);
    color: var(--red);
  }

  .batch-warning,
  .batch-note,
  .batch-state {
    display: flex;
    max-width: 70ch;
    align-items: center;
    gap: 7px;
    margin-top: 4px;
    color: var(--ink-soft);
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .batch-warning,
  .error-state {
    color: var(--red);
  }

  .batch-warning a {
    font-weight: 760;
    text-underline-offset: 3px;
  }

  .batch-progress {
    display: grid;
    max-width: 470px;
    gap: 5px;
    margin-top: 5px;
  }

  .batch-progress div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--green-deep);
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.63rem;
    font-variant-numeric: tabular-nums;
  }

  .batch-progress progress {
    width: 100%;
    height: 5px;
    border: 0;
    border-radius: 999px;
    background: var(--paper-strong);
    accent-color: var(--green-deep);
  }

  @media (max-width: 720px) {
    .batch-export {
      grid-template-columns: 44px minmax(0, 1fr);
    }

    .batch-actions {
      min-width: 0;
      grid-column: 1 / -1;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .batch-actions button:only-child {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 430px) {
    .batch-export {
      padding: 14px;
    }

    .batch-actions {
      grid-template-columns: 1fr;
    }

    .batch-actions button:only-child {
      grid-column: auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .batch-actions button {
      transition-duration: 1ms;
    }

    .batch-actions button:hover:not(:disabled) {
      transform: none;
    }
  }
</style>
