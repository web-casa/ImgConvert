<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount } from "svelte";
  import { CloseIcon, Tuning2Icon } from "@solar-icons/svelte/bold-duotone";
  import { DangerCircleIcon } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import ConversionPanel from "$lib/components/ConversionPanel.svelte";
  import { trapTabWithin } from "$lib/focus-trap";
  import { hasInvalidWorkflowConfiguration, persistenceStatus } from "$lib/state.svelte";

  let { desktopFocusTarget = null }: { desktopFocusTarget?: HTMLElement | null } = $props();

  // Hand-rolled right-side sheet (no drawer primitive in this repo), following
  // the ComparisonPreview focus-trap pattern: backdrop click and Escape close,
  // Tab cycles inside, focus returns to the trigger.
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let drawer = $state<HTMLDivElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let previousFocus: HTMLElement | null = null;
  const needsAttention = $derived(hasInvalidWorkflowConfiguration() || !!persistenceStatus.error);

  function openDrawer() {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    open = true;
  }

  function closeDrawer() {
    if (!open) return;
    open = false;
    (previousFocus ?? trigger)?.focus();
  }

  function closeDrawerForDesktop() {
    if (!open) return;
    open = false;
    previousFocus = null;
    queueMicrotask(() => desktopFocusTarget?.focus());
  }

  onMount(() => {
    const desktopQuery = window.matchMedia("(min-width: 900px)");
    const handleBreakpointChange = (event: MediaQueryListEvent) => {
      if (event.matches) closeDrawerForDesktop();
    };
    desktopQuery.addEventListener("change", handleBreakpointChange);
    return () => desktopQuery.removeEventListener("change", handleBreakpointChange);
  });

  $effect(() => {
    if (open && closeButton) closeButton.focus();
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (drawer) trapTabWithin(event, drawer);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="min-[900px]:hidden">
  <button
    bind:this={trigger}
    type="button"
    class="flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium outline-none transition-colors ease-[var(--motion-ease-img)] hover:border-primary/35 focus-visible:ring-3 focus-visible:ring-ring/50"
    aria-label={$t("settings.title")}
    aria-expanded={open}
    aria-controls="settings-drawer"
    onclick={openDrawer}
  >
    <Tuning2Icon size={16} class="text-primary" />
    <span class="max-[519px]:sr-only">{$t("settings.title")}</span>
    {#if needsAttention}
      <DangerCircleIcon size={16} class="text-destructive" aria-hidden="true" />
      <span class="sr-only">{$t("app.settingsNeedAttention")}</span>
    {/if}
  </button>
</div>

{#if open}
  <div
    class="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
    role="presentation"
    onclick={closeDrawer}
  ></div>
  <div
    bind:this={drawer}
    id="settings-drawer"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-drawer-title"
    tabindex="-1"
    class="fixed inset-y-0 right-0 z-50 flex w-[min(420px,100dvw)] flex-col border-l bg-background shadow-2xl"
  >
    <header class="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
      <h2 id="settings-drawer-title" class="text-sm font-semibold">{$t("settings.title")}</h2>
      <Button
        bind:ref={closeButton}
        variant="ghost"
        size="icon"
        class="size-11 sm:size-10"
        aria-label={$t("app.closeSettings")}
        title={$t("app.closeSettings")}
        onclick={closeDrawer}
      >
        <CloseIcon size={20} />
      </Button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <ConversionPanel hideHeader />
    </div>
  </div>
{/if}
