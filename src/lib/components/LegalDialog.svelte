<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { CloseIcon, GlobalIcon } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import appIconUrl from "$lib/assets/app-icon.png";
  import { EXTERNAL_LINKS, openExternalUrl } from "$lib/external-links";
  import { trapTabWithin } from "$lib/focus-trap";
  import {
    formatLocalizedMessage,
    translationMessage,
    type LocalizedMessage,
  } from "$lib/localized-message";

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let licenseText = $state("");
  let loading = $state(false);
  let loadError = $state<LocalizedMessage | null>(null);
  let dialog = $state<HTMLDivElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let previousFocus: HTMLElement | null = null;
  let openingWebsite = $state(false);
  let websiteOpenFailed = $state(false);

  onMount(() => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton?.focus();
  });

  onDestroy(() => previousFocus?.focus());

  $effect(() => {
    if (!open || licenseText || loading) return;

    loading = true;
    loadError = null;
    void fetch("THIRD_PARTY_LICENSES.md")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.text();
      })
      .then((text) => {
        licenseText = text;
      })
      .catch((error: unknown) => {
        loadError = translationMessage("legal.loadError", { error: String(error) });
      })
      .finally(() => {
        loading = false;
      });
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

  function localizedText(message: LocalizedMessage, currentTranslation: unknown): string {
    void currentTranslation;
    return formatLocalizedMessage(message);
  }

  async function openWebsite() {
    if (openingWebsite) return;

    openingWebsite = true;
    websiteOpenFailed = false;
    try {
      await openExternalUrl(EXTERNAL_LINKS.website);
    } catch {
      websiteOpenFailed = true;
    } finally {
      openingWebsite = false;
    }
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
      bind:this={dialog}
      class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border bg-card shadow-xl sm:h-[min(78vh,760px)] sm:max-w-4xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-title"
      tabindex="-1"
    >
      <header class="flex items-start gap-3 border-b px-4 py-3">
        <div class="min-w-0 flex-1">
          <h2 id="legal-title" class="text-sm font-semibold">{$t("legal.title")}</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            {$t("legal.description")}
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

      <div class="min-h-0 flex-1 overflow-auto bg-background px-4 py-3">
        <section
          class="mb-3 flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
          aria-labelledby="about-app-title"
        >
          <div class="flex min-w-0 items-center gap-3">
            <img
              src={appIconUrl}
              alt=""
              class="size-10 shrink-0 rounded-xl shadow-sm ring-1 ring-border/70"
              width="40"
              height="40"
              aria-hidden="true"
            />
            <div class="min-w-0">
              <h3 id="about-app-title" class="text-sm font-semibold">ImgConvert</h3>
              <p class="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                {EXTERNAL_LINKS.website}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onclick={() => void openWebsite()}
            disabled={openingWebsite}
          >
            <GlobalIcon size={18} />
            {$t("externalLinks.openWebsite")}
          </Button>
          {#if websiteOpenFailed}
            <p class="text-xs text-destructive sm:max-w-48" aria-live="polite">
              {$t("externalLinks.openFailed")}
            </p>
          {/if}
        </section>
        {#if loadError}
          <p class="text-sm text-destructive">{localizedText(loadError, $t)}</p>
        {:else if loading && !licenseText}
          <p class="text-sm text-muted-foreground">{$t("legal.loading")}</p>
        {:else}
          <pre
            class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">{licenseText}</pre>
        {/if}
      </div>
    </div>
  </div>
{/if}
