<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { Sun, Moon, Desktop, Info, PuzzlePiece, Sparkle, DownloadSimple } from "phosphor-svelte";
  import { Button } from "$lib/components/ui/button";
  import appIconUrl from "$lib/assets/app-icon.png";
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
  const themeLabel = $derived(
    settings.theme === "dark" ? "深色" : settings.theme === "light" ? "浅色" : "跟随系统",
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
      title="减少界面动画:{settings.reduceMotion ? '开' : '关'}"
      class={settings.reduceMotion ? "text-primary" : "text-muted-foreground"}
      aria-pressed={settings.reduceMotion}
      onclick={toggleMotion}
    >
      <Sparkle weight={settings.reduceMotion ? "regular" : "duotone"} />
      减少动画
    </Button>
    <Button variant="ghost" size="icon" title="主题:{themeLabel}" onclick={cycleTheme}>
      <ThemeIcon weight="duotone" />
    </Button>
    <Button variant="ghost" size="icon" title="插件诊断" onclick={onOpenPluginDiagnostics}>
      <PuzzlePiece weight="duotone" />
    </Button>
    {#if updaterEnabled}
      <Button variant="ghost" size="icon" title="应用更新" onclick={onOpenUpdates}>
        <DownloadSimple weight="duotone" />
      </Button>
    {/if}
    <Button variant="ghost" size="icon" title="开源许可" onclick={onOpenLegal}>
      <Info weight="duotone" />
    </Button>
  </div>
</header>
