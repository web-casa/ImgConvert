<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import {
    Sun,
    Moon,
    Desktop,
    Info,
    PuzzlePiece,
    Sparkle,
    DownloadSimple,
    Translate,
  } from "phosphor-svelte";
  import { t } from "svelte-i18n";
  import { Button } from "$lib/components/ui/button";
  import appIconUrl from "$lib/assets/app-icon.png";
  import { setAppLocale } from "$lib/i18n";
  import { settings, engine, applyTheme, persistSettings, updaterEnabled } from "$lib/state.svelte";

  let {
    onOpenLegal,
    onOpenPluginDiagnostics,
    onOpenUpdates,
  }: {
    onOpenLegal: () => void;
    onOpenPluginDiagnostics: () => void;
    onOpenUpdates: () => void;
  } = $props();

  const themeIcon = $derived(
    settings.theme === "dark" ? Moon : settings.theme === "light" ? Sun : Desktop,
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
    setAppLocale(settings.locale);
    void persistSettings();
  }

  const ThemeIcon = $derived(themeIcon);
</script>

<header class="flex min-w-0 items-center gap-3">
  <img
    src={appIconUrl}
    alt=""
    class="size-9 shrink-0 rounded-[0.7rem] shadow-sm ring-1 ring-border/70"
    width="36"
    height="36"
    aria-hidden="true"
  />
  <h1 class="shrink-0 text-lg font-bold">ImgConvert</h1>
  <span
    class="min-w-0 flex-1 truncate text-xs {engine.ok ? 'text-emerald-600' : 'text-destructive'}"
    title={engine.text}
  >
    {engine.text}
  </span>

  <div class="flex shrink-0 items-center gap-1">
    <Button
      variant="ghost"
      size="sm"
      title={`${$t("topbar.reduceMotion")}:${
        settings.reduceMotion ? $t("topbar.reduceMotionOn") : $t("topbar.reduceMotionOff")
      }`}
      class={settings.reduceMotion ? "text-primary" : "text-muted-foreground"}
      aria-pressed={settings.reduceMotion}
      onclick={toggleMotion}
    >
      <Sparkle weight={settings.reduceMotion ? "regular" : "duotone"} />
      {$t("topbar.reduceMotion")}
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title={`${$t("topbar.theme")}:${$t(themeLabelKey)}`}
      onclick={cycleTheme}
    >
      <ThemeIcon weight="duotone" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title={$t("topbar.language")}
      aria-pressed={settings.locale !== "zh-CN"}
      onclick={toggleLocale}
    >
      <Translate weight="duotone" />
      <span class="text-[10px] font-semibold">{settings.locale === "zh-CN" ? "EN" : "ZH"}</span>
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title={$t("topbar.pluginDiagnostics")}
      onclick={onOpenPluginDiagnostics}
    >
      <PuzzlePiece weight="duotone" />
    </Button>
    {#if updaterEnabled}
      <Button variant="ghost" size="icon" title={$t("topbar.appUpdate")} onclick={onOpenUpdates}>
        <DownloadSimple weight="duotone" />
      </Button>
    {/if}
    <Button variant="ghost" size="icon" title={$t("topbar.licenses")} onclick={onOpenLegal}>
      <Info weight="duotone" />
    </Button>
  </div>
</header>
