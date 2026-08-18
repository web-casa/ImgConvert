<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { ArrowClockwise, CheckCircle, DownloadSimple, WarningCircle, X } from "phosphor-svelte";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import {
    appUpdate,
    checkForAppUpdate,
    installAppUpdate,
    isTauriRuntime,
  } from "$lib/state.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let wasOpen = $state(false);

  const progressPercent = $derived(
    appUpdate.contentLength && appUpdate.contentLength > 0
      ? Math.min(100, Math.round((appUpdate.downloadedBytes / appUpdate.contentLength) * 100))
      : 0,
  );
  const busy = $derived(appUpdate.checking || appUpdate.installing);

  $effect(() => {
    const opened = open && !wasOpen;
    wasOpen = open;
    if (!opened || appUpdate.checked || appUpdate.checking) return;
    void checkForAppUpdate();
  });

  function close() {
    open = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (open && event.key === "Escape") close();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 grid bg-background/80 p-3 backdrop-blur-sm sm:place-items-center"
    role="presentation"
    onclick={handleBackdropClick}
  >
    <div
      class="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-title"
      tabindex="-1"
    >
      <header class="flex items-start gap-3 border-b px-4 py-3">
        <DownloadSimple size={22} weight="duotone" class="mt-0.5 text-primary" />
        <div class="min-w-0 flex-1">
          <h2 id="update-title" class="text-sm font-semibold">{$t("topbar.appUpdate")}</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            {isTauriRuntime() ? $t("update.directBuildSubtitle") : $t("update.webPreview")}
          </p>
        </div>
        <Button variant="ghost" size="icon" title={$t("legal.close")} onclick={close}>
          <X />
        </Button>
      </header>

      <div class="grid gap-3 bg-background px-4 py-4">
        {#if appUpdate.error}
          <div
            class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <WarningCircle size={17} weight="fill" class="mt-0.5 shrink-0" />
            <span>{appUpdate.error}</span>
          </div>
        {:else if appUpdate.available}
          <div class="rounded-md border bg-card px-3 py-3">
            <div class="flex items-start gap-2">
              <DownloadSimple size={18} weight="duotone" class="mt-0.5 text-primary" />
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  {appUpdate.currentVersion ?? $t("update.currentVersion")} → {appUpdate.version}
                </p>
                {#if appUpdate.date}
                  <p class="mt-1 text-xs text-muted-foreground">{appUpdate.date}</p>
                {/if}
              </div>
            </div>
            {#if appUpdate.body}
              <p class="mt-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {appUpdate.body}
              </p>
            {/if}
          </div>
        {:else if appUpdate.checked}
          <div
            class="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
          >
            <CheckCircle size={17} weight="fill" class="mt-0.5 shrink-0" />
            <span>{appUpdate.message || $t("update.latest")}</span>
          </div>
        {:else}
          <p class="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
            {$t("update.checking")}
          </p>
        {/if}

        {#if appUpdate.installing}
          <div class="rounded-md border bg-card px-3 py-3">
            <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{appUpdate.message}</span>
              <span class="tabular-nums">{progressPercent}%</span>
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-all duration-300 ease-[var(--motion-ease-img)]"
                style={`width: ${progressPercent}%`}
              ></div>
            </div>
          </div>
        {/if}
      </div>

      <footer class="flex items-center justify-end gap-2 border-t px-4 py-3">
        <Button variant="ghost" size="sm" onclick={checkForAppUpdate} disabled={busy}>
          <ArrowClockwise class={appUpdate.checking ? "animate-spin" : ""} />
          {$t("update.check")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onclick={installAppUpdate}
          disabled={!appUpdate.available || busy}
        >
          <DownloadSimple />
          {$t("update.installAndRestart")}
        </Button>
      </footer>
    </div>
  </div>
{/if}
