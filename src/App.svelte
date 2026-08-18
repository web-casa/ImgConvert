<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "svelte-i18n";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import {
    IconContext,
    ArrowsClockwise,
    CheckCircle,
    PlayCircle,
    StopCircle,
    Trash,
    WarningCircle,
  } from "phosphor-svelte";
  import { Button } from "$lib/components/ui/button";
  import Dropzone from "$lib/components/Dropzone.svelte";
  import LegalDialog from "$lib/components/LegalDialog.svelte";
  import PluginDiagnosticsDialog from "$lib/components/PluginDiagnosticsDialog.svelte";
  import QueueItem from "$lib/components/QueueItem.svelte";
  import SettingsBar from "$lib/components/SettingsBar.svelte";
  import Topbar from "$lib/components/Topbar.svelte";
  import UpdateDialog from "$lib/components/UpdateDialog.svelte";
  import {
    addDemoItems,
    cancelConversion,
    checkEngine,
    clearQueue,
    convertAll,
    engine,
    importPastedClipboard,
    importPaths,
    initPersistence,
    isTauriRuntime,
    persistenceReady,
    queue,
    settings,
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
  let pluginDiagnosticsOpen = $state(false);
  let updateOpen = $state(false);
  const progressLabel = $derived(
    queue.length
      ? `${doneCount}/${queue.length} 完成${skippedCount ? ` · ${skippedCount} 跳过` : ""}${errorCount ? ` · ${errorCount} 错误` : ""}`
      : "0 个文件",
  );

  onMount(() => {
    const runningInTauri = isTauriRuntime();
    void initPersistence().then(async () => {
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

<IconContext values={{ weight: "duotone", size: 20 }}>
  {#if persistenceReady.ready}
    <main class="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {#if ui.dragActive}
        <div
          class="pointer-events-none fixed inset-0 z-40 grid place-items-center border-4 border-primary/50 bg-primary/10 backdrop-blur-sm"
        >
          <div class="rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-md">
            释放以扫描图片
          </div>
        </div>
      {/if}

      <div class="shrink-0 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <Topbar
          onOpenLegal={() => (legalOpen = true)}
          onOpenPluginDiagnostics={() => (pluginDiagnosticsOpen = true)}
          onOpenUpdates={() => (updateOpen = true)}
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          class="mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-4 px-4 py-4 pb-28 min-[720px]:grid-cols-[minmax(0,1fr)_340px] min-[720px]:items-start min-[880px]:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px] 2xl:grid-cols-[minmax(0,1fr)_420px]"
        >
          <section class="flex min-w-0 flex-col gap-4">
            <Dropzone />

            <section class="flex min-h-[18rem] flex-col gap-3">
              <div class="rounded-md border bg-card px-3 py-2">
                <div class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  {#if runningCount}
                    <ArrowsClockwise size={15} class="animate-spin text-primary" />
                  {:else if errorCount}
                    <WarningCircle size={15} weight="fill" class="text-destructive" />
                  {:else if settledCount && settledCount === queue.length && !skippedCount}
                    <CheckCircle size={15} weight="fill" class="text-emerald-600" />
                  {:else if skippedCount}
                    <WarningCircle size={15} weight="fill" class="text-muted-foreground" />
                  {/if}
                  <span class="truncate">{progressLabel}</span>
                </div>

                {#if queue.length}
                  <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-primary transition-all duration-300 ease-[var(--motion-ease-img)]"
                      style={`width: ${overallProgress}%`}
                    ></div>
                  </div>
                {/if}
              </div>

              <ul
                class="grid grid-cols-1 content-start gap-3 lg:grid-cols-2 2xl:grid-cols-3"
                aria-label="转换队列"
              >
                {#each queue as item (item.key)}
                  <QueueItem {item} />
                {:else}
                  <li
                    class="col-span-full flex min-h-48 items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground"
                  >
                    还没有文件
                  </li>
                {/each}
              </ul>
            </section>
          </section>

          <aside class="min-w-0 min-[720px]:sticky min-[720px]:top-4">
            <SettingsBar variant="panel" />
          </aside>
        </div>
      </div>

      <footer
        class="shrink-0 border-t bg-background/95 px-4 py-3 shadow-[0_-12px_32px_rgba(15,23,42,0.08)] backdrop-blur"
      >
        <div
          class="mx-auto flex w-full max-w-[1440px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-2 text-sm font-medium">
              {#if runningCount}
                <ArrowsClockwise size={17} class="animate-spin text-primary" />
              {:else if errorCount}
                <WarningCircle size={17} weight="fill" class="text-destructive" />
              {:else if settledCount && settledCount === queue.length && !skippedCount}
                <CheckCircle size={17} weight="fill" class="text-emerald-600" />
              {/if}
              <span class="truncate">{progressLabel}</span>
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              {queue.length
                ? `目标格式 ${settings.format.toUpperCase()} · ${engine.text}`
                : "添加图片后开始批量转换或压缩"}
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onclick={clearQueue}
              disabled={ui.converting || ui.importing || !queue.length}
            >
              <Trash />
              清空
            </Button>
            <Button
              variant={ui.converting ? "destructive" : "default"}
              size="default"
              class="min-w-40 justify-center font-semibold shadow-sm"
              onclick={ui.converting ? cancelConversion : convertAll}
              disabled={ui.converting
                ? ui.cancelRequested
                : ui.importing || !queue.length || !engine.ok}
            >
              {#if ui.converting}
                <StopCircle />
                {ui.cancelRequested ? "取消中" : "取消转换"}
              {:else}
                <PlayCircle />
                开始转换 / 压缩
              {/if}
            </Button>
          </div>
        </div>

        {#if queue.length}
          <div class="mx-auto mt-3 h-1.5 max-w-[1440px] overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary transition-all duration-300 ease-[var(--motion-ease-img)]"
              style={`width: ${overallProgress}%`}
            ></div>
          </div>
        {/if}
      </footer>
    </main>

    <PluginDiagnosticsDialog bind:open={pluginDiagnosticsOpen} />
    <UpdateDialog bind:open={updateOpen} />
    <LegalDialog bind:open={legalOpen} />
  {:else}
    <div class="grid h-dvh place-items-center bg-background text-sm text-muted-foreground">
      {$t("app.loading")}
    </div>
  {/if}
</IconContext>
