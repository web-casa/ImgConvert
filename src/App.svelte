<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "svelte-i18n";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import {
    PlayCircleIcon,
    RefreshIcon,
    StopCircleIcon,
    TrashBinMinimalisticIcon,
  } from "@solar-icons/svelte/bold-duotone";
  import { CheckCircleIcon, DangerCircleIcon } from "@solar-icons/svelte/bold-duotone";
  import { Button } from "$lib/components/ui/button";
  import Dropzone from "$lib/components/Dropzone.svelte";
  import ComparisonPreview from "$lib/components/ComparisonPreview.svelte";
  import ConversionPanel from "$lib/components/ConversionPanel.svelte";
  import QueueItem from "$lib/components/QueueItem.svelte";
  import OutputDestinationControl from "$lib/components/OutputDestinationControl.svelte";
  import SettingsDrawer from "$lib/components/SettingsDrawer.svelte";
  import Topbar from "$lib/components/Topbar.svelte";
  import {
    addDemoItems,
    cancelConversion,
    checkEngine,
    clearQueue,
    comparisonPreview,
    convertAll,
    engine,
    importPastedClipboard,
    importPaths,
    hasInvalidWorkflowConfiguration,
    initPersistence,
    isTauriRuntime,
    persistenceReady,
    queue,
    settings,
    seedDesktopE2E,
    ui,
  } from "$lib/state.svelte";

  const doneCount = $derived(queue.filter((item) => item.status === "done").length);
  const skippedCount = $derived(queue.filter((item) => item.status === "skipped").length);
  const errorCount = $derived(queue.filter((item) => item.status === "error").length);
  const runningCount = $derived(queue.filter((item) => item.status === "running").length);
  const settledCount = $derived(doneCount + skippedCount + errorCount);
  const overallProgress = $derived(
    queue.length ? Math.round((settledCount / queue.length) * 100) : 0,
  );
  let legalOpen = $state(false);
  let privacySupportOpen = $state(false);
  let pluginDiagnosticsOpen = $state(false);
  let updateOpen = $state(false);
  let desktopSettingsPanel = $state<HTMLElement | null>(null);
  onMount(() => {
    const runningInTauri = isTauriRuntime();
    void initPersistence().then(async () => {
      try {
        await seedDesktopE2E();
      } catch (error) {
        console.warn("Failed to seed desktop E2E queue:", error);
      }
      await checkEngine();
      if (!runningInTauri) addDemoItems();
    });

    if (!runningInTauri) return;

    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (ui.converting || ui.importing) {
        ui.dragActive = false;
        return;
      }

      if (event.payload.type === "over") {
        ui.dragActive = true;
      } else if (event.payload.type === "drop") {
        ui.dragActive = false;
        void importPaths(event.payload.paths);
      } else {
        ui.dragActive = false;
      }
    });

    return () => {
      unlisten.then((cleanup) => cleanup());
    };
  });

  function handlePaste(event: ClipboardEvent) {
    void importPastedClipboard(event);
  }
</script>

<svelte:window onpaste={handlePaste} />

{#if persistenceReady.ready}
  <main class="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
    {#if ui.dragActive}
      <div
        class="pointer-events-none fixed inset-0 z-40 grid place-items-center border-4 border-primary/50 bg-primary/10 backdrop-blur-sm"
      >
        <div class="rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-md">
          {$t("app.dropToScan")}
        </div>
      </div>
    {/if}

    <div
      class="relative z-30 shrink-0 border-b bg-background/95 px-4 py-3 backdrop-blur [@media(max-height:640px)]:py-2.5"
    >
      <Topbar
        onOpenLegal={() => (legalOpen = true)}
        onOpenPrivacySupport={() => (privacySupportOpen = true)}
        onOpenPluginDiagnostics={() => (pluginDiagnosticsOpen = true)}
        onOpenUpdates={() => (updateOpen = true)}
      />
    </div>

    <div data-testid="workspace-scroll" class="min-h-0 flex-1 overflow-y-auto">
      <div
        class="mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-4 px-4 py-4 min-[900px]:grid-cols-[minmax(0,1fr)_355px] min-[900px]:items-start xl:grid-cols-[minmax(0,1fr)_400px]"
      >
        <section class="flex min-w-0 flex-col gap-4">
          <Dropzone />

          <section class="flex min-h-[18rem] flex-col gap-3">
            <ul class="flex flex-col gap-2" aria-label={$t("app.queueAriaLabel")}>
              {#each queue as item (item.key)}
                <QueueItem {item} />
              {:else}
                <li
                  class="flex min-h-32 items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground"
                >
                  {$t("app.emptyQueue")}
                </li>
              {/each}
            </ul>
          </section>
        </section>

        <aside
          bind:this={desktopSettingsPanel}
          tabindex="-1"
          class="hidden min-w-0 outline-none min-[900px]:sticky min-[900px]:top-4 min-[900px]:block"
        >
          <ConversionPanel />
        </aside>
      </div>
    </div>

    <footer
      data-testid="action-dock"
      class="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur"
    >
      <div
        class="mx-auto flex w-full max-w-[1440px] flex-col gap-3 [@media(min-width:900px)_and_(min-height:641px)]:flex-row [@media(min-width:900px)_and_(min-height:641px)]:items-center [@media(min-width:900px)_and_(min-height:641px)]:gap-4 xl:gap-6"
      >
        <div class="min-w-0 shrink-0 min-[900px]:w-72 lg:w-auto lg:max-w-[24rem]">
          <OutputDestinationControl />
        </div>

        <div class="min-w-0 flex-1" aria-live="polite">
          <div class="flex min-w-0 items-center gap-2 text-sm font-medium">
            {#if runningCount}
              <RefreshIcon size={17} class="animate-spin text-primary" />
            {:else if errorCount}
              <DangerCircleIcon size={17} class="text-destructive" />
            {:else if settledCount && settledCount === queue.length && !skippedCount}
              <CheckCircleIcon size={17} class="text-success" />
            {:else if skippedCount}
              <DangerCircleIcon size={17} class="text-muted-foreground" />
            {/if}
            <span class="truncate">
              {#if queue.length}
                {$t("app.progressDone", {
                  values: { done: doneCount, total: queue.length },
                })}{#if skippedCount}{$t("app.progressSkipped", {
                    values: { skipped: skippedCount },
                  })}{/if}{#if errorCount}{$t("app.progressErrors", {
                    values: { errors: errorCount },
                  })}{/if}
              {:else}
                {$t("app.zeroFiles")}
              {/if}
            </span>
          </div>
          <div class="mt-0.5 truncate text-xs text-muted-foreground">
            {queue.length
              ? $t("app.footerTargetFormat", {
                  values: { format: settings.format.toUpperCase(), engine: engine.text },
                })
              : $t("app.addImagesHint")}
          </div>
          {#if queue.length}
            <div
              class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={$t("app.batchProgress")}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={overallProgress}
            >
              <div
                class="h-full rounded-full bg-primary transition-all duration-300 ease-[var(--motion-ease-img)]"
                style={`width: ${overallProgress}%`}
              ></div>
            </div>
          {/if}
        </div>

        <div class="flex shrink-0 items-center gap-2 min-[900px]:justify-end">
          <SettingsDrawer desktopFocusTarget={desktopSettingsPanel} />
          <Button
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-10"
            onclick={clearQueue}
            disabled={ui.converting || ui.importing || !queue.length}
          >
            <TrashBinMinimalisticIcon size={20} />
            {$t("app.clear")}
          </Button>
          <Button
            data-testid="start-conversion"
            variant={ui.converting ? "destructive" : "default"}
            size="default"
            class="min-h-11 min-w-40 justify-center font-semibold shadow-sm sm:min-h-10"
            onclick={ui.converting ? cancelConversion : convertAll}
            disabled={ui.converting
              ? ui.cancelRequested
              : ui.importing || !queue.length || !engine.ok || hasInvalidWorkflowConfiguration()}
          >
            {#if ui.converting}
              <StopCircleIcon size={20} />
              {ui.cancelRequested ? $t("app.canceling") : $t("app.cancelConversion")}
            {:else}
              <PlayCircleIcon size={20} />
              {$t("app.startConversion")}
            {/if}
          </Button>
        </div>
      </div>
    </footer>
  </main>

  {#if pluginDiagnosticsOpen}
    {#await import("$lib/components/PluginDiagnosticsDialog.svelte") then { default: PluginDiagnosticsDialog }}
      <PluginDiagnosticsDialog bind:open={pluginDiagnosticsOpen} />
    {/await}
  {/if}

  {#if updateOpen}
    {#await import("$lib/components/UpdateDialog.svelte") then { default: UpdateDialog }}
      <UpdateDialog bind:open={updateOpen} />
    {/await}
  {/if}

  {#if privacySupportOpen}
    {#await import("$lib/components/PrivacySupportDialog.svelte") then { default: PrivacySupportDialog }}
      <PrivacySupportDialog bind:open={privacySupportOpen} />
    {/await}
  {/if}

  {#if legalOpen}
    {#await import("$lib/components/LegalDialog.svelte") then { default: LegalDialog }}
      <LegalDialog bind:open={legalOpen} />
    {/await}
  {/if}

  {#if comparisonPreview.open}
    <ComparisonPreview />
  {/if}
{:else}
  <div class="grid h-dvh place-items-center bg-background text-sm text-muted-foreground">
    {$t("app.loading")}
  </div>
{/if}
