<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "svelte-i18n";
  import { ArrowsClockwise, CheckCircle, Image, WarningCircle, X } from "phosphor-svelte";
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
  class="group grid min-h-40 grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-lg border bg-background p-3 transition-colors ease-[var(--motion-ease-img)] hover:border-primary/35"
>
  <div
    class="flex h-full min-h-32 flex-col justify-between rounded-md border p-2 {sourceAccent.border} {sourceAccent.background}"
  >
    <div
      class="relative flex h-20 items-center justify-center overflow-hidden rounded bg-background/65"
    >
      {#if item.thumbnailStatus === "ready" && item.thumbnail}
        <img src={item.thumbnail.url} alt="" class="h-full w-full object-cover" draggable="false" />
      {:else if item.thumbnailStatus === "loading"}
        <ArrowsClockwise size={22} class="animate-spin {sourceAccent.text}" />
      {:else}
        <Image size={24} weight="duotone" class={sourceAccent.text} />
      {/if}
    </div>
    <div class="space-y-1">
      <div class="text-[11px] font-medium uppercase tracking-wide {sourceAccent.text}">
        {sourceFormat ? formatLabel(sourceFormat) : "IMG"}
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-background/70">
        <div
          class="h-full rounded-full bg-primary transition-all duration-300 ease-[var(--motion-ease-img)]"
          style={`width: ${progress}%`}
        ></div>
      </div>
    </div>
  </div>

  <div class="flex min-w-0 flex-col gap-3">
    <div class="flex min-w-0 items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium" title={item.path}>{item.name}</div>
        <div class="truncate text-xs text-muted-foreground" title={item.path}>
          {item.path}
        </div>
        {#if metadataText}
          <div class="mt-0.5 text-xs text-muted-foreground">{metadataText}</div>
        {/if}
      </div>

      <button
        class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
        onclick={() => removeItem(item.path)}
        disabled={busy}
        aria-label={$t("queueItem.remove")}
      >
        <X size={16} />
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <span
        class="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs {targetAccent.border} {targetAccent.background} {targetAccent.text}"
      >
        {#if item.status === "running"}
          <ArrowsClockwise size={13} class="animate-spin" />
        {:else if item.status === "done"}
          <CheckCircle size={13} weight="fill" />
        {:else if item.status === "skipped"}
          <WarningCircle size={13} weight="fill" />
        {:else if item.status === "error"}
          <WarningCircle size={13} weight="fill" />
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
        globalLabel={$t("queueItem.followGlobal", { format: formatLabel(settings.format) })}
        triggerClass="w-36"
        triggerSize="sm"
        disabled={busy}
        {sourceFormats}
        onChange={updateFormat}
      />
    </div>

    <div class="min-h-8">
      {#if item.detail}
        <div
          class="line-clamp-2 text-xs {item.status === 'error'
            ? 'text-destructive'
            : 'text-muted-foreground'}"
        >
          {item.detail}
        </div>
      {:else}
        <div class="text-xs text-muted-foreground">
          {$t("queueItem.outputsTo", { format: formatLabel(targetFormat) })}
        </div>
      {/if}
    </div>
  </div>
</li>
