<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    CloseIcon,
    DownloadMinimalisticIcon,
    GlobalIcon,
    LinkSquareIcon,
    RefreshIcon,
  } from "@solar-icons/svelte/bold-duotone";
  import { CheckCircleIcon, DangerCircleIcon } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import { EXTERNAL_LINKS, openExternalUrl, type ExternalLinkUrl } from "$lib/external-links";
  import { trapTabWithin } from "$lib/focus-trap";
  import {
    appUpdate,
    checkForAppUpdate,
    installAppUpdate,
    isTauriRuntime,
  } from "$lib/state.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let wasOpen = $state(false);
  let dialog = $state<HTMLDivElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let previousFocus: HTMLElement | null = null;
  let openingLink = $state<ExternalLinkUrl | null>(null);
  let externalLinkOpenFailed = $state(false);

  onMount(() => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton?.focus();
  });

  onDestroy(() => previousFocus?.focus());

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
    if (!open) return;
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      close();
      return;
    }
    if (dialog) trapTabWithin(event, dialog);
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  async function openLink(url: ExternalLinkUrl) {
    if (openingLink) return;

    openingLink = url;
    externalLinkOpenFailed = false;
    try {
      await openExternalUrl(url);
    } catch {
      externalLinkOpenFailed = true;
    } finally {
      openingLink = null;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-background/80 p-3 backdrop-blur-sm"
    role="presentation"
    onclick={handleBackdropClick}
  >
    <div
      bind:this={dialog}
      class="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-title"
      tabindex="-1"
    >
      <header class="flex items-start gap-3 border-b px-4 py-3">
        <DownloadMinimalisticIcon size={22} class="mt-0.5 text-primary" />
        <div class="min-w-0 flex-1">
          <h2 id="update-title" class="text-sm font-semibold">{$t("topbar.appUpdate")}</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            {isTauriRuntime() ? $t("update.directBuildSubtitle") : $t("update.webPreview")}
          </p>
        </div>
        <Button
          bind:ref={closeButton}
          variant="ghost"
          size="icon"
          title={$t("legal.close")}
          onclick={close}
        >
          <CloseIcon size={20} />
        </Button>
      </header>

      <div class="grid min-h-0 gap-3 overflow-y-auto bg-background px-4 py-4">
        {#if appUpdate.error}
          <div
            class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <DangerCircleIcon size={17} class="mt-0.5 shrink-0" />
            <span>{appUpdate.error}</span>
          </div>
        {:else if appUpdate.available}
          <div class="rounded-md border bg-card px-3 py-3">
            <div class="flex items-start gap-2">
              <DownloadMinimalisticIcon size={18} class="mt-0.5 text-primary" />
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
            <CheckCircleIcon size={17} class="mt-0.5 shrink-0" />
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

        <section class="rounded-md border bg-card p-3" aria-labelledby="update-links-title">
          <h3 id="update-links-title" class="text-xs font-semibold uppercase tracking-wide">
            {$t("update.officialLinks")}
          </h3>
          <div class="mt-2 grid gap-2">
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left outline-none transition-colors hover:border-primary/35 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              onclick={() => void openLink(EXTERNAL_LINKS.website)}
              disabled={openingLink !== null}
            >
              <GlobalIcon size={18} class="shrink-0 text-primary" />
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-medium">{$t("externalLinks.website")}</span>
                <span class="block break-all font-mono text-[10px] text-muted-foreground">
                  {EXTERNAL_LINKS.website}
                </span>
              </span>
            </button>
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left outline-none transition-colors hover:border-primary/35 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              onclick={() => void openLink(EXTERNAL_LINKS.repository)}
              disabled={openingLink !== null}
            >
              <LinkSquareIcon size={18} class="shrink-0 text-primary" />
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-medium">
                  {$t("externalLinks.githubRepository")}
                </span>
                <span class="block break-all font-mono text-[10px] text-muted-foreground">
                  {EXTERNAL_LINKS.repository}
                </span>
              </span>
            </button>
          </div>
          {#if externalLinkOpenFailed}
            <p class="mt-2 text-xs text-destructive" aria-live="polite">
              {$t("externalLinks.openFailed")}
            </p>
          {/if}
        </section>
      </div>

      <footer class="flex items-center justify-end gap-2 border-t px-4 py-3">
        <Button variant="ghost" size="sm" onclick={checkForAppUpdate} disabled={busy}>
          <RefreshIcon size={20} class={appUpdate.checking ? "animate-spin" : ""} />
          {$t("update.check")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onclick={installAppUpdate}
          disabled={!appUpdate.available || busy}
        >
          <DownloadMinimalisticIcon size={20} />
          {$t("update.installAndRestart")}
        </Button>
      </footer>
    </div>
  </div>
{/if}
