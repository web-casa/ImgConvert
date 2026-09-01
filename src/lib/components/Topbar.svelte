<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import {
    DownloadMinimalisticIcon,
    GlobalIcon,
    InfoCircleIcon,
    MonitorIcon,
    MoonIcon,
    SettingsMinimalisticIcon,
    ShieldCheckIcon,
    StarShineIcon,
    SunIcon,
    TranslationIcon,
    WidgetIcon,
  } from "@solar-icons/svelte/bold-duotone";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import appIconUrl from "$lib/assets/app-icon.png";
  import { EXTERNAL_LINKS, openExternalUrl } from "$lib/external-links";
  import { setAppLocale } from "$lib/i18n";
  import { settings, engine, applyTheme, persistSettings, updaterEnabled } from "$lib/state.svelte";

  let {
    onOpenLegal,
    onOpenPrivacySupport,
    onOpenPluginDiagnostics,
    onOpenUpdates,
  }: {
    onOpenLegal: () => void;
    onOpenPrivacySupport: () => void;
    onOpenPluginDiagnostics: () => void;
    onOpenUpdates: () => void;
  } = $props();

  const themeIcon = $derived(
    settings.theme === "dark" ? MoonIcon : settings.theme === "light" ? SunIcon : MonitorIcon,
  );
  const themeLabelKey = $derived(
    settings.theme === "dark"
      ? "topbar.themeDark"
      : settings.theme === "light"
        ? "topbar.themeLight"
        : "topbar.themeSystem",
  );

  function cycleTheme() {
    const order = ["light", "dark", "system"] as const;
    settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
    applyTheme();
    persistSettings();
  }
  function toggleMotion() {
    settings.reduceMotion = !settings.reduceMotion;
    applyTheme();
    persistSettings();
  }
  function toggleLocale() {
    settings.locale = settings.locale === "zh-CN" ? "en-US" : "zh-CN";
    void setAppLocale(settings.locale);
    void persistSettings();
  }

  // Hand-rolled utility popover (no popover primitive in this repo): transparent
  // backdrop for outside-click close, Escape close, and focus restoration to
  // the trigger, following the existing dialog patterns.
  let utilityMenuOpen = $state(false);
  let utilityMenuTrigger = $state<HTMLButtonElement | null>(null);
  let utilityMenuContainer = $state<HTMLDivElement | null>(null);
  let utilityMenuPanel = $state<HTMLDivElement | null>(null);
  let openingWebsite = $state(false);
  let websiteOpenFailed = $state(false);

  function toggleUtilityMenu() {
    utilityMenuOpen = !utilityMenuOpen;
  }

  function closeUtilityMenu() {
    if (!utilityMenuOpen) return;
    utilityMenuOpen = false;
    utilityMenuTrigger?.focus();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (utilityMenuOpen && event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      closeUtilityMenu();
    }
  }

  function handleUtilityFocusOut(event: FocusEvent) {
    if (!utilityMenuOpen) return;
    const next = event.relatedTarget;
    if (next instanceof Node && utilityMenuContainer?.contains(next)) return;
    utilityMenuOpen = false;
  }

  async function openWebsite() {
    if (openingWebsite) return;

    openingWebsite = true;
    websiteOpenFailed = false;
    try {
      await openExternalUrl(EXTERNAL_LINKS.website);
      closeUtilityMenu();
    } catch {
      websiteOpenFailed = true;
    } finally {
      openingWebsite = false;
    }
  }

  $effect(() => {
    if (utilityMenuOpen && utilityMenuPanel) {
      utilityMenuPanel.querySelector<HTMLElement>("button[aria-pressed]")?.focus();
    }
  });

  const ThemeIcon = $derived(themeIcon);
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<header class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap">
  <img
    src={appIconUrl}
    alt=""
    class="size-9 shrink-0 rounded-[0.7rem] shadow-sm ring-1 ring-border/70"
    width="36"
    height="36"
    aria-hidden="true"
  />
  <h1 class="shrink-0 text-lg font-semibold tracking-tight">ImgConvert</h1>
  <span
    class="inline-flex min-w-0 max-w-72 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs {engine.ok
      ? 'border-success/35 bg-success/10 text-success'
      : 'border-destructive/35 bg-destructive/10 text-destructive'}"
    title={engine.text}
  >
    <span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true"></span>
    <span class="truncate">{engine.text}</span>
  </span>

  <div
    class="order-last flex w-full shrink-0 items-center justify-end gap-1 sm:order-none sm:w-auto sm:flex-1"
  >
    <Button
      variant="ghost"
      size="icon"
      class="size-11 sm:size-10"
      title={`${$t("topbar.theme")}:${$t(themeLabelKey)}`}
      aria-label={`${$t("topbar.theme")}:${$t(themeLabelKey)}`}
      onclick={cycleTheme}
    >
      <ThemeIcon size={20} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="size-11 sm:size-10"
      title={$t("topbar.language")}
      aria-label={$t("topbar.language")}
      aria-pressed={settings.locale !== "zh-CN"}
      onclick={toggleLocale}
    >
      <TranslationIcon size={20} />
      <span class="text-[10px] font-semibold">{settings.locale === "zh-CN" ? "EN" : "ZH"}</span>
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="size-11 sm:size-10"
      title={$t("topbar.pluginDiagnostics")}
      aria-label={$t("topbar.pluginDiagnostics")}
      onclick={onOpenPluginDiagnostics}
    >
      <WidgetIcon size={20} />
    </Button>
    {#if updaterEnabled}
      <Button
        variant="ghost"
        size="icon"
        class="size-11 sm:size-10"
        title={$t("topbar.appUpdate")}
        aria-label={$t("topbar.appUpdate")}
        onclick={onOpenUpdates}
      >
        <DownloadMinimalisticIcon size={20} />
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      class="size-11 sm:size-10"
      title={$t("topbar.privacySupport")}
      aria-label={$t("topbar.privacySupport")}
      onclick={onOpenPrivacySupport}
    >
      <ShieldCheckIcon size={20} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="size-11 sm:size-10"
      title={$t("topbar.licenses")}
      aria-label={$t("topbar.licenses")}
      onclick={onOpenLegal}
    >
      <InfoCircleIcon size={20} />
    </Button>

    <div bind:this={utilityMenuContainer} class="relative" onfocusout={handleUtilityFocusOut}>
      <Button
        bind:ref={utilityMenuTrigger}
        variant="ghost"
        size="icon"
        class="size-11 sm:size-10 {utilityMenuOpen || settings.reduceMotion
          ? 'text-primary'
          : 'text-muted-foreground'}"
        title={$t("topbar.utilityMenu")}
        aria-label={$t("topbar.utilityMenu")}
        aria-controls="utility-settings-popover"
        aria-expanded={utilityMenuOpen}
        onclick={toggleUtilityMenu}
      >
        <SettingsMinimalisticIcon size={20} />
      </Button>
      {#if utilityMenuOpen}
        <div class="fixed inset-0 z-40" role="presentation" onclick={closeUtilityMenu}></div>
        <div
          bind:this={utilityMenuPanel}
          id="utility-settings-popover"
          class="absolute right-0 top-full z-50 mt-2 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            aria-pressed={settings.reduceMotion}
            class="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
            onclick={toggleMotion}
          >
            <StarShineIcon size={20} class="size-5 shrink-0" />
            <span class="min-w-0 flex-1">{$t("topbar.reduceMotion")}</span>
            <span class="shrink-0 text-xs text-muted-foreground">
              {settings.reduceMotion ? $t("topbar.reduceMotionOn") : $t("topbar.reduceMotionOff")}
            </span>
          </button>
          <button
            type="button"
            class="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
            onclick={() => void openWebsite()}
            aria-busy={openingWebsite}
          >
            <GlobalIcon size={20} class="size-5 shrink-0" />
            <span class="min-w-0 flex-1">{$t("topbar.returnToWebsite")}</span>
          </button>
          {#if websiteOpenFailed}
            <p class="px-2 py-1.5 text-xs text-destructive" aria-live="polite">
              {$t("externalLinks.openFailed")}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</header>
