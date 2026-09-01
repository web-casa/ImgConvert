<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { CloseIcon, RefreshIcon } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import { trapTabWithin } from "$lib/focus-trap";
  import {
    closeComparisonPreview,
    comparisonPreview,
    fmtSize,
    formatConvertWarning,
    refreshComparisonPreview,
    setComparisonReveal,
  } from "$lib/state.svelte";

  let closeButton = $state<HTMLButtonElement | null>(null);
  let dialog = $state<HTMLDivElement | null>(null);
  let previousFocus: HTMLElement | null = null;
  const warningMessages = $derived(
    comparisonPreview.result?.warnings.flatMap(formatConvertWarning) ?? [],
  );

  onMount(() => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton?.focus();
  });

  onDestroy(() => previousFocus?.focus());

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeComparisonPreview();
      return;
    }
    if (dialog) trapTabWithin(event, dialog);
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) closeComparisonPreview();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm sm:p-6"
  role="presentation"
  onclick={handleBackdropClick}
>
  <div
    bind:this={dialog}
    data-testid="comparison-preview"
    data-status={comparisonPreview.loading
      ? "loading"
      : comparisonPreview.error
        ? "error"
        : comparisonPreview.result
          ? "ready"
          : "idle"}
    class="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="comparison-preview-title"
    tabindex="-1"
  >
    <header class="flex shrink-0 items-start justify-between gap-4 border-b px-4 py-3 sm:px-5">
      <div class="min-w-0">
        <h2 id="comparison-preview-title" class="text-base font-semibold">
          {$t("workflow.preview.title")}
        </h2>
        <p class="mt-0.5 truncate text-xs text-muted-foreground" title={comparisonPreview.itemName}>
          {comparisonPreview.itemName}
          {#if comparisonPreview.result?.sourcePage}
            · {$t("workflow.preview.pdfPage", {
              values: { page: comparisonPreview.result.sourcePage },
            })}
          {/if}
        </p>
      </div>
      <Button
        bind:ref={closeButton}
        data-testid="comparison-preview-close"
        variant="ghost"
        size="icon"
        class="size-11 sm:size-10"
        onclick={closeComparisonPreview}
        aria-label={$t("workflow.preview.close")}
      >
        <CloseIcon size={20} />
      </Button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <div
        class="relative mx-auto aspect-[4/3] max-h-[62dvh] w-full overflow-hidden rounded-lg border bg-[repeating-conic-gradient(var(--muted)_0_25%,var(--background)_0_50%)] bg-[length:20px_20px]"
      >
        {#if comparisonPreview.beforeUrl && comparisonPreview.afterUrl}
          <img
            src={comparisonPreview.beforeUrl}
            alt={$t("workflow.preview.before")}
            class="absolute inset-0 h-full w-full select-none object-contain"
            draggable="false"
          />
          <img
            src={comparisonPreview.afterUrl}
            alt={$t("workflow.preview.after")}
            class="absolute inset-0 h-full w-full select-none object-contain"
            style={`clip-path: inset(0 ${100 - comparisonPreview.reveal}% 0 0)`}
            draggable="false"
          />
          <div
            class="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
            style={`left: ${comparisonPreview.reveal}%`}
          ></div>
          <span
            class="absolute left-3 top-3 rounded bg-black/65 px-2 py-1 text-[11px] font-medium text-white"
          >
            {$t("workflow.preview.before")}
          </span>
          <span
            class="absolute right-3 top-3 rounded bg-black/65 px-2 py-1 text-[11px] font-medium text-white"
          >
            {$t("workflow.preview.after")}
          </span>
        {/if}

        {#if comparisonPreview.loading}
          <div
            class="absolute inset-0 grid place-items-center bg-background/75 text-sm backdrop-blur-sm"
            role="status"
          >
            <span class="flex items-center gap-2">
              <RefreshIcon size={20} class="animate-spin text-primary" />
              {$t("workflow.preview.loading")}
            </span>
          </div>
        {/if}

        {#if comparisonPreview.error && !comparisonPreview.loading}
          <div class="absolute inset-0 grid place-items-center bg-background/90 p-6" role="alert">
            <p class="max-w-lg text-center text-sm text-destructive">
              {$t("workflow.preview.error", {
                values: { message: comparisonPreview.error },
              })}
            </p>
          </div>
        {/if}
      </div>

      {#if comparisonPreview.stale && !comparisonPreview.loading && !comparisonPreview.error}
        <div
          class="mt-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="status"
        >
          <span class="min-w-0 flex-1">{$t("workflow.preview.stale")}</span>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            onclick={() => refreshComparisonPreview()}
          >
            <RefreshIcon size={20} />
            {$t("workflow.preview.refresh")}
          </Button>
        </div>
      {/if}

      <label class="mt-3 block space-y-1.5 text-xs text-muted-foreground">
        <span>{$t("workflow.preview.reveal")}</span>
        <input
          class="h-11 w-full cursor-ew-resize accent-primary disabled:cursor-not-allowed"
          type="range"
          min="0"
          max="100"
          step="1"
          value={comparisonPreview.reveal}
          disabled={comparisonPreview.loading || !comparisonPreview.afterUrl}
          oninput={(event) => setComparisonReveal(Number(event.currentTarget.value))}
        />
      </label>

      {#if comparisonPreview.result}
        <div class="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-md border bg-background/60 px-3 py-2">
            <span class="block text-muted-foreground">{$t("workflow.preview.before")}</span>
            <b class="mt-0.5 block font-medium">
              {$t("workflow.preview.dimensions", {
                values: {
                  width: comparisonPreview.result.sourceWidth,
                  height: comparisonPreview.result.sourceHeight,
                },
              })}
            </b>
          </div>
          <div class="rounded-md border bg-background/60 px-3 py-2">
            <span class="block text-muted-foreground">{$t("workflow.preview.after")}</span>
            <b class="mt-0.5 block font-medium">
              {$t("workflow.preview.dimensions", {
                values: {
                  width: comparisonPreview.result.outputWidth,
                  height: comparisonPreview.result.outputHeight,
                },
              })}
            </b>
          </div>
          <div class="rounded-md border bg-background/60 px-3 py-2">
            <span class="block text-muted-foreground">
              {$t("workflow.preview.outputSize", {
                values: { size: fmtSize(comparisonPreview.result.outputSize) },
              })}
            </span>
            {#if comparisonPreview.result.selectedQuality !== null}
              <b class="mt-0.5 block font-medium">
                {$t("workflow.preview.quality", {
                  values: { quality: comparisonPreview.result.selectedQuality },
                })}
              </b>
            {/if}
          </div>
          <div class="rounded-md border bg-background/60 px-3 py-2">
            {#if comparisonPreview.result.targetSizeMet !== null}
              <b
                class={comparisonPreview.result.targetSizeMet
                  ? "font-medium text-success"
                  : "font-medium text-amber-700 dark:text-amber-300"}
              >
                {$t(
                  comparisonPreview.result.targetSizeMet
                    ? "workflow.preview.targetMet"
                    : "workflow.preview.targetNotMet",
                )}
              </b>
            {:else}
              <span class="text-muted-foreground">—</span>
            {/if}
          </div>
        </div>

        {#if warningMessages.length}
          <ul
            class="mt-3 space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            {#each warningMessages as warning, index (`${index}:${warning}`)}
              <li>{warning}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <footer class="flex shrink-0 justify-end gap-2 border-t px-4 py-3 sm:px-5">
      <Button
        variant="outline"
        class="min-h-11 sm:min-h-10"
        onclick={() => refreshComparisonPreview()}
        disabled={comparisonPreview.loading}
      >
        <RefreshIcon size={20} class={comparisonPreview.loading ? "animate-spin" : ""} />
        {$t("workflow.preview.refresh")}
      </Button>
      <Button class="min-h-11 sm:min-h-10" onclick={closeComparisonPreview}>
        {$t("workflow.preview.close")}
      </Button>
    </footer>
  </div>
</div>
