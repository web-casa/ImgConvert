<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { RefreshIcon } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import SettingsBar from "$lib/components/SettingsBar.svelte";
  import WorkflowSettings from "$lib/components/WorkflowSettings.svelte";
  import {
    effectiveQualityFor,
    queue,
    resetItemFormats,
    settings,
    supportsLossless,
    ui,
  } from "$lib/state.svelte";

  // Visual composition only: all settings state stays in `state.svelte.ts` and
  // is edited by the composed sections. The header summary mirrors the format
  // and effective quality so the collapsed sections still tell the truth.
  // `hideHeader` is used by the settings drawer, which provides its own title.
  let { hideHeader = false }: { hideHeader?: boolean } = $props();

  const busy = $derived(ui.converting || ui.importing);
  const canLossless = $derived(supportsLossless(settings.format));
  const qualityEnabled = $derived(settings.format !== "png" && !(canLossless && settings.lossless));
  const autoQualitySupported = $derived(
    ["jpeg", "webp"].includes(settings.format) && qualityEnabled && !settings.targetSizeEnabled,
  );
  const qualityTitleKey = $derived(
    (settings.autoQuality && autoQualitySupported) || settings.targetSizeEnabled
      ? "settings.qualityUpperBound"
      : "settings.quality",
  );
  const effectiveQuality = $derived(effectiveQualityFor(settings.format));
  const qualityLabel = $derived(
    qualityEnabled && effectiveQuality > settings.quality
      ? `${settings.quality} -> ${effectiveQuality}`
      : `${settings.quality}`,
  );
</script>

<section class="h-fit rounded-lg border bg-card">
  {#if !hideHeader}
    <header class="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">{$t("settings.title")}</h2>
        <p class="mt-1 truncate text-xs text-muted-foreground">
          {settings.format.toUpperCase()} · {$t(qualityTitleKey)}
          {qualityLabel}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onclick={resetItemFormats}
        disabled={busy || !queue.length}
        class="shrink-0"
      >
        <RefreshIcon size={20} />
        {$t("settings.followGlobal")}
      </Button>
    </header>
  {/if}

  <div class="divide-y divide-border/70">
    <WorkflowSettings />
    <SettingsBar />
  </div>
</section>
