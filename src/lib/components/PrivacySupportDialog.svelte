<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { ArrowSquareOut, ShieldCheck, X } from "phosphor-svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import { isTauriRuntime, settings } from "$lib/state.svelte";
  import privacyEnglish from "../../../PRIVACY.en.md?raw";
  import privacyChinese from "../../../PRIVACY.md?raw";

  const SUPPORT_URL = "https://github.com/web-casa/ImgConvert/issues";

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let openingSupport = $state(false);
  let supportOpenFailed = $state(false);
  const policyText = $derived(settings.locale === "zh-CN" ? privacyChinese : privacyEnglish);

  function close() {
    open = false;
  }

  async function openSupport() {
    if (openingSupport) return;

    openingSupport = true;
    supportOpenFailed = false;
    try {
      if (isTauriRuntime()) {
        await openUrl(SUPPORT_URL);
      } else if (!window.open(SUPPORT_URL, "_blank", "noopener,noreferrer")) {
        throw new Error("support window blocked");
      }
    } catch {
      supportOpenFailed = true;
    } finally {
      openingSupport = false;
    }
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
      class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border bg-card shadow-xl sm:h-[min(82vh,820px)] sm:max-w-4xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-support-title"
      tabindex="-1"
    >
      <header class="flex items-start gap-3 border-b px-4 py-3">
        <div
          class="grid size-9 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10 text-primary"
        >
          <ShieldCheck size={20} weight="duotone" aria-hidden="true" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 id="privacy-support-title" class="text-sm font-semibold">
            {$t("privacySupport.title")}
          </h2>
          <p class="mt-1 text-xs text-muted-foreground">
            {$t("privacySupport.description")}
          </p>
        </div>
        <Button variant="ghost" size="icon" title={$t("privacySupport.close")} onclick={close}>
          <X />
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto bg-background px-4 py-4">
        <section class="rounded-lg border bg-card p-3" aria-labelledby="included-policy-title">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 id="included-policy-title" class="text-sm font-semibold">
                {$t("privacySupport.localPolicy")}
              </h3>
              <p class="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                {$t("privacySupport.localPolicyDescription")}
              </p>
            </div>
            <span
              class="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 font-mono text-[10px] font-medium tracking-[0.08em] text-primary"
            >
              {$t("privacySupport.localCopyBadge")}
            </span>
          </div>
          <pre
            class="mt-3 max-h-[min(40vh,28rem)] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-[11px] leading-5 text-muted-foreground"
            aria-label={$t("privacySupport.localPolicy")}>{policyText}</pre>
        </section>

        <section class="mt-3 rounded-lg border bg-card p-3" aria-labelledby="support-title">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <h3 id="support-title" class="text-sm font-semibold">
                {$t("privacySupport.support")}
              </h3>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {$t("privacySupport.supportDescription")}
              </p>
              <p class="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                {$t("privacySupport.supportUrl")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onclick={() => void openSupport()}
              disabled={openingSupport}
            >
              <ArrowSquareOut />
              {openingSupport
                ? $t("privacySupport.openingSupport")
                : $t("privacySupport.openSupport")}
            </Button>
          </div>
          {#if supportOpenFailed}
            <p
              class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              aria-live="polite"
            >
              {$t("privacySupport.openSupportError")}
            </p>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}
