<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { CloseIcon } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import {
    formatLocalizedMessage,
    translationMessage,
    type LocalizedMessage,
  } from "$lib/localized-message";

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let licenseText = $state("");
  let loading = $state(false);
  let loadError = $state<LocalizedMessage | null>(null);

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
    if (open && event.key === "Escape") close();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function localizedText(message: LocalizedMessage, currentTranslation: unknown): string {
    void currentTranslation;
    return formatLocalizedMessage(message);
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
        <Button variant="ghost" size="icon" title={$t("legal.close")} onclick={close}>
          <CloseIcon size={20} />
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto bg-background px-4 py-3">
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
