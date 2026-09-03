<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import CircleStop from "@lucide/svelte/icons/circle-stop";
  import Download from "@lucide/svelte/icons/download";
  import Eye from "@lucide/svelte/icons/eye";
  import FileImage from "@lucide/svelte/icons/file-image";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";

  import {
    formatBytes,
    formatDimensions,
    formatDuration,
    formatResultDimensions,
    outputLabel,
    resultDelta,
    warningText,
  } from "./format";
  import type { QueueConversionResult, QueueEntry } from "./queue";
  import type { Copy } from "./workbench";

  /**
   * 队列面板:标题/汇总/清空 + 空态或行列表。转换生命周期与操作由 App 统一持有。
   */
  let {
    copy,
    numberLocale,
    entries,
    totalBytes,
    onOpenClear,
    onCancelProbe,
    onRetry,
    onPreview,
    onDownload,
    onRemove,
  }: {
    copy: Copy;
    numberLocale: string;
    entries: QueueEntry[];
    totalBytes: number;
    onOpenClear: () => void;
    onCancelProbe: (entry: QueueEntry) => void;
    onRetry: (entry: QueueEntry) => void;
    onPreview: (entry: QueueEntry, result?: QueueConversionResult) => void;
    onDownload: (entry: QueueEntry, result?: QueueConversionResult) => void;
    onRemove: (entry: QueueEntry) => void;
  } = $props();

  function entryResults(entry: QueueEntry): QueueConversionResult[] {
    return entry.result
      ? [entry.result, ...(entry.additionalResults ?? [])]
      : (entry.additionalResults ?? []);
  }

  function pageLabel(template: string, pageNumber: number, numberLocale: string): string {
    return template.replace("{page}", new Intl.NumberFormat(numberLocale).format(pageNumber));
  }

  function countLabel(count: number, singular: string, plural: string): string {
    return `${new Intl.NumberFormat(numberLocale).format(count)} ${count === 1 ? singular : plural}`;
  }
</script>

<section class="queue-panel" aria-labelledby="queue-title">
  <div class="panel-heading">
    <div>
      <p class="section-label">
        QUEUE / {new Intl.NumberFormat(numberLocale).format(entries.length)}
      </p>
      <h2 id="queue-title">{copy.queue.title}</h2>
    </div>
    <div class="queue-summary">
      <span>{formatBytes(totalBytes, numberLocale)}</span>
      <button type="button" disabled={entries.length === 0} onclick={onOpenClear}>
        <Trash2 size={16} aria-hidden="true" />{copy.actions.clear}
      </button>
    </div>
  </div>

  {#if entries.length === 0}
    <div class="empty-state">
      <span><FileImage size={25} aria-hidden="true" /></span>
      <div>
        <h3>{copy.queue.emptyTitle}</h3>
        <p>{copy.queue.emptyBody}</p>
      </div>
    </div>
  {:else}
    <ul class="queue-list">
      {#each entries as entry (entry.id)}
        <li
          class:has-error={entry.state === "failed"}
          class:has-result={entry.state === "done"}
          class="queue-item"
        >
          <div class="thumbnail">
            <FileImage size={22} aria-hidden="true" />
            {#if entry.state === "done" && entry.result}
              <img
                src={entry.result.previewUrl}
                alt=""
                width="64"
                height="64"
                loading="lazy"
                decoding="async"
                draggable="false"
              />
            {:else if entry.probe && entry.probe.format !== "pdf"}
              <img
                src={entry.previewUrl}
                alt=""
                width="64"
                height="64"
                loading="lazy"
                decoding="async"
                draggable="false"
                onerror={(event) => ((event.currentTarget as HTMLImageElement).hidden = true)}
              />
            {/if}
          </div>
          <div class="file-detail">
            <div class="file-name-row">
              <strong title={entry.name}>{entry.name}</strong>
              <span
                class:status-error={entry.state === "failed"}
                class:status-result={entry.state === "done"}
                class="status-badge"
              >
                {#if entry.state === "probing" || entry.state === "converting"}
                  <LoaderCircle class="spin" size={13} aria-hidden="true" />
                {:else if entry.state === "ready" || entry.state === "done"}
                  <Check size={13} aria-hidden="true" />
                {:else if entry.state === "failed"}
                  <TriangleAlert size={13} aria-hidden="true" />
                {/if}
                {copy.states[entry.state]}
              </span>
            </div>
            {#if entry.result}
              <p class="file-facts result-facts">
                <span>{outputLabel(entry.result.format)}</span>
                {#if entry.probe?.format === "pdf"}
                  <span
                    >{countLabel(
                      entryResults(entry).length,
                      copy.queue.pageReady,
                      copy.queue.pagesReady,
                    )}</span
                  >
                  <span
                    >{formatBytes(
                      entryResults(entry).reduce((total, result) => total + result.size, 0),
                      numberLocale,
                    )}</span
                  >
                  {#if entry.pageFailures?.length}
                    <span class="larger-result"
                      >{countLabel(
                        entry.pageFailures.length,
                        copy.queue.pageFailed,
                        copy.queue.pagesFailed,
                      )}</span
                    >
                  {/if}
                {:else}
                  <span>{formatResultDimensions(entry, numberLocale)}</span>
                  <span>{formatBytes(entry.result.size, numberLocale)}</span>
                  <span class:larger-result={entry.result.size > entry.size}
                    >{resultDelta(
                      entry,
                      numberLocale,
                      copy.preview.saved,
                      copy.preview.larger,
                    )}</span
                  >
                {/if}
              </p>
            {:else}
              <p class="file-facts">
                <span
                  >{entry.probe?.format.toUpperCase() ??
                    entry.name.split(".").pop()?.toUpperCase() ??
                    "IMG"}</span
                >
                <span>{formatDimensions(entry, numberLocale)}</span><span
                  >{formatBytes(entry.size, numberLocale)}</span
                >
              </p>
            {/if}
            {#if entry.failure}
              <p class="file-message error-message" role="alert">
                {copy.errors[entry.failure.code]}
              </p>
            {:else if entry.conversionFailure}
              <p class="file-message error-message" role="alert">
                {copy.conversionErrors[entry.conversionFailure.code]}
              </p>
            {:else if entry.state === "converting" && entry.progress}
              <div class="conversion-progress" role="status" aria-live="polite">
                <div class="progress-copy">
                  <span
                    >{copy.progress[
                      entry.progress.phase
                    ]}{#if entry.progress.pageNumber !== undefined}
                      · {copy.pdfProgress
                        .replace(
                          "{page}",
                          new Intl.NumberFormat(numberLocale).format(entry.progress.pageNumber),
                        )
                        .replace(
                          "{total}",
                          new Intl.NumberFormat(numberLocale).format(entry.progress.pageTotal ?? 1),
                        )}{/if}</span
                  >
                  <span>{Math.round(entry.progress.value * 100)}%</span>
                </div>
                <progress
                  max="100"
                  value={Math.round(entry.progress.value * 100)}
                  aria-label={copy.progress[entry.progress.phase]}
                ></progress>
              </div>
            {:else if entry.result && entry.probe?.format === "pdf"}
              <p class="file-message result-message">
                <span
                  >{countLabel(
                    entryResults(entry).length,
                    copy.queue.pageReady,
                    copy.queue.pagesReady,
                  )}</span
                >
                {#if entry.pdfPageCount}
                  <span
                    >{copy.queue.pdfTotal.replace(
                      "{count}",
                      new Intl.NumberFormat(numberLocale).format(entry.pdfPageCount),
                    )}</span
                  >
                {/if}
              </p>
            {:else if entry.result}
              <p class="file-message result-message">
                {entry.result.name} · {copy.preview.duration}
                {formatDuration(entry.result.durationMs, numberLocale)}
              </p>
            {:else if entry.gifFirstFrameNotice}
              <p class="file-message warning-message">
                <TriangleAlert size={14} aria-hidden="true" />{copy.warning.gifFirstFrame}
              </p>
            {:else if entry.warning}
              <p class="file-message warning-message">
                <TriangleAlert size={14} aria-hidden="true" />{warningText(
                  entry.warning,
                  copy.warning.mismatch,
                )}
              </p>
            {:else}
              <p class="file-message">{copy.states[entry.state]}</p>
            {/if}

            {#if entry.probe?.format === "pdf" && entry.result}
              <ul class="pdf-page-results">
                {#each entryResults(entry) as result (result.pageNumber)}
                  <li>
                    <span>
                      <strong
                        >{pageLabel(
                          copy.queue.pageLabel,
                          result.pageNumber ?? 1,
                          numberLocale,
                        )}</strong
                      >
                      <small
                        >{formatBytes(result.size, numberLocale)} · {new Intl.NumberFormat(
                          numberLocale,
                        ).format(result.width)} × {new Intl.NumberFormat(numberLocale).format(
                          result.height,
                        )}</small
                      >
                    </span>
                    <span class="pdf-page-actions">
                      <button
                        type="button"
                        aria-label={`${copy.actions.preview}: ${result.name}`}
                        title={copy.actions.preview}
                        onclick={() => onPreview(entry, result)}
                        ><Eye size={16} aria-hidden="true" /></button
                      >
                      <button
                        type="button"
                        aria-label={`${copy.actions.download}: ${result.name}`}
                        title={copy.actions.download}
                        onclick={() => onDownload(entry, result)}
                        ><Download size={16} aria-hidden="true" /></button
                      >
                    </span>
                  </li>
                {/each}
                {#each entry.pageFailures ?? [] as page (page.pageNumber)}
                  <li class="pdf-page-failed">
                    <span>
                      <strong
                        >{pageLabel(copy.queue.pageLabel, page.pageNumber, numberLocale)}</strong
                      >
                      <small>{copy.conversionErrors[page.failure.code]}</small>
                    </span>
                    <TriangleAlert size={16} aria-hidden="true" />
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <div class="item-actions">
            {#if entry.state === "queued" || entry.state === "probing"}
              <button
                type="button"
                aria-label={`${copy.actions.cancelProbe}: ${entry.name}`}
                title={copy.actions.cancelProbe}
                onclick={() => onCancelProbe(entry)}
                ><CircleStop size={18} aria-hidden="true" /></button
              >
            {:else if entry.state === "failed" || entry.state === "cancelled"}
              <button
                type="button"
                aria-label={`${copy.actions.retry}: ${entry.name}`}
                title={copy.actions.retry}
                onclick={() => onRetry(entry)}><RotateCcw size={17} aria-hidden="true" /></button
              >
            {:else if entry.state === "done" && entry.result && entry.probe?.format !== "pdf"}
              <button
                type="button"
                aria-label={`${copy.actions.preview}: ${entry.name}`}
                title={copy.actions.preview}
                onclick={() => onPreview(entry)}><Eye size={18} aria-hidden="true" /></button
              >
              <button
                class="download-action"
                type="button"
                aria-label={`${copy.actions.download}: ${entry.result.name}`}
                title={copy.actions.download}
                onclick={() => onDownload(entry)}><Download size={18} aria-hidden="true" /></button
              >
            {/if}
            <button
              type="button"
              aria-label={`${copy.actions.remove}: ${entry.name}`}
              title={copy.actions.remove}
              onclick={() => onRemove(entry)}><X size={18} aria-hidden="true" /></button
            >
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
