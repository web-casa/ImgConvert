<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "svelte-i18n";
  import {
    ArrowRightIcon,
    GalleryIcon,
    RefreshIcon,
    TransferHorizontalIcon,
    CloseIcon,
    DocumentTextIcon,
  } from "@solar-icons/svelte/bold-duotone";
  import { CheckCircleIcon, DangerCircleIcon } from "@solar-icons/svelte/bold-duotone";
  import FormatSelect from "$lib/components/FormatSelect.svelte";
  import {
    extOf,
    formatAccent,
    formatFromExt,
    formatImageMetadata,
    formatLabel,
    ensureThumbnail,
    itemProgress,
    itemTargetFormat,
    openComparisonPreview,
    removeItem,
    setItemTargetFormat,
    settings,
    ui,
    type QueueItem,
  } from "$lib/state.svelte";

  let { item }: { item: QueueItem } = $props();
  let root: HTMLLIElement | undefined;

  const busy = $derived(ui.converting || ui.importing);
  const sourceFormat = $derived(item.metadata?.format ?? formatFromExt(extOf(item.path)));
  const targetFormat = $derived(itemTargetFormat(item));
  const sourceAccent = $derived(formatAccent(sourceFormat));
  const targetAccent = $derived(formatAccent(targetFormat));
  const progress = $derived(itemProgress(item));
  const sourceFormats = $derived(sourceFormat ? [sourceFormat] : []);
  const metadataText = $derived(formatImageMetadata(item.metadata));
  function updateFormat(value: string) {
    setItemTargetFormat(item.path, value === "__global" ? null : value);
  }

  onMount(() => {
    if (!root) return;
    if (typeof IntersectionObserver === "undefined") {
      ensureThumbnail(item);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          ensureThumbnail(item);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  });
</script>

<li
  bind:this={root}
  data-testid="queue-item"
  data-status={item.status}
  class="group flex min-h-28 flex-wrap items-center gap-3 rounded-lg border bg-background p-3 transition-colors ease-[var(--motion-ease-img)] hover:border-primary/35 min-[900px]:min-h-24"
>
  <div
    class="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border sm:size-[72px] {sourceAccent.border} {sourceAccent.background}"
  >
    {#if item.thumbnailStatus === "ready" && item.thumbnail}
      <img src={item.thumbnail.url} alt="" class="h-full w-full object-cover" draggable="false" />
    {:else if item.thumbnailStatus === "loading"}
      <RefreshIcon size={22} class="animate-spin {sourceAccent.text}" />
    {:else if sourceFormat === "pdf"}
      <DocumentTextIcon size={24} class={sourceAccent.text} />
    {:else}
      <GalleryIcon size={24} class={sourceAccent.text} />
    {/if}
    {#if item.thumbnail?.warningCount}
      <span
        class="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-amber-500/90 text-white"
        title={$t("queueItem.pdfThumbnailWarnings", {
          values: { count: item.thumbnail.warningCount },
        })}
        aria-label={$t("queueItem.pdfThumbnailWarnings", {
          values: { count: item.thumbnail.warningCount },
        })}
      >
        <DangerCircleIcon size={14} aria-hidden="true" />
      </span>
    {/if}
  </div>

  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium" title={item.path}>{item.name}</div>
    <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span class="shrink-0 font-medium uppercase {sourceAccent.text}">
        {sourceFormat ? formatLabel(sourceFormat) : "IMG"}
      </span>
      <ArrowRightIcon size={12} class="shrink-0" aria-hidden="true" />
      <span class="shrink-0 font-medium uppercase {targetAccent.text}">
        {formatLabel(targetFormat)}
      </span>
      {#if metadataText}
        <span class="min-w-0 truncate tabular-nums">· {metadataText}</span>
      {/if}
    </div>
    <div class="mt-1 min-h-4">
      {#if item.detail}
        <div
          title={item.detail}
          class="truncate text-xs {item.status === 'error'
            ? 'text-destructive'
            : 'text-muted-foreground'}"
        >
          {item.detail}
        </div>
      {/if}
    </div>
    <div
      class="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={$t("queueItem.progress", { values: { name: item.name } })}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={progress}
    >
      <div
        class="h-full rounded-full bg-primary transition-all duration-300 ease-[var(--motion-ease-img)]"
        style={`width: ${progress}%`}
      ></div>
    </div>
  </div>

  <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
    <span
      class="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs {targetAccent.border} {targetAccent.background} {targetAccent.text}"
    >
      {#if item.status === "running"}
        <RefreshIcon size={13} class="animate-spin" />
      {:else if item.status === "done"}
        <CheckCircleIcon size={13} />
      {:else if item.status === "skipped"}
        <DangerCircleIcon size={13} />
      {:else if item.status === "error"}
        <DangerCircleIcon size={13} />
      {/if}
      {item.status === "running"
        ? $t("queueItem.running")
        : item.status === "done"
          ? $t("queueItem.done")
          : item.status === "skipped"
            ? $t("queueItem.skipped")
            : item.status === "error"
              ? $t("queueItem.error")
              : $t("queueItem.pending")}
    </span>

    <FormatSelect
      value={item.targetFormat ?? "__global"}
      includeGlobal
      globalLabel={$t("queueItem.followGlobal", {
        values: { format: formatLabel(settings.format) },
      })}
      triggerClass="w-32 xl:w-36"
      triggerSize="sm"
      ariaLabel={$t("queueItem.targetFormat", { values: { name: item.name } })}
      disabled={busy}
      {sourceFormats}
      onChange={updateFormat}
    />

    <button
      data-testid="comparison-preview-open"
      class="inline-flex h-11 items-center gap-1 rounded-md border bg-background px-2 text-xs text-muted-foreground outline-none transition-colors hover:border-primary/35 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 sm:h-10"
      onclick={() => openComparisonPreview(item)}
      disabled={busy}
      aria-label={$t("queueItem.compare")}
      title={$t("queueItem.compare")}
    >
      <TransferHorizontalIcon size={14} />
      <span class="max-[1199px]:hidden">{$t("workflow.preview.open")}</span>
    </button>

    <button
      class="size-11 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-30 sm:size-10"
      onclick={() => removeItem(item.path)}
      disabled={busy}
      aria-label={$t("queueItem.remove")}
    >
      <CloseIcon size={16} />
    </button>
  </div>
</li>
