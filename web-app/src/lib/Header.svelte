<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Languages from "@lucide/svelte/icons/languages";
  import MonitorDown from "@lucide/svelte/icons/monitor-down";
  import Moon from "@lucide/svelte/icons/moon";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Sun from "@lucide/svelte/icons/sun";

  import appIconUrl from "../../../src/lib/assets/app-icon.png";
  import type { Copy, Theme } from "./workbench";
  import type { Locale } from "./copy";

  /** 顶栏:品牌、隐私徽标、帮助、语言/主题切换、桌面端链接。标记与原版一致。 */
  let {
    copy,
    locale,
    theme,
    onToggleLocale,
    onToggleTheme,
  }: {
    copy: Copy;
    locale: Locale;
    theme: Theme;
    onToggleLocale: () => void;
    onToggleTheme: () => void;
  } = $props();
</script>

<header class="app-header">
  <a class="brand" href="/" aria-label={copy.header.home} translate="no">
    <img src={appIconUrl} alt="" width="34" height="34" aria-hidden="true" />
    <span>ImgConvert</span><small>WEB</small>
  </a>
  <div class="header-actions">
    <span class="privacy-chip"
      ><ShieldCheck size={16} aria-hidden="true" />{copy.header.privacy}</span
    >
    <a class="header-link help-link" href="/docs/">
      <CircleHelp size={17} aria-hidden="true" />{copy.header.help}
    </a>
    <button
      class="icon-button"
      type="button"
      aria-label={copy.header.language}
      onclick={onToggleLocale}
    >
      <Languages size={18} aria-hidden="true" /><span>{locale === "zh" ? "EN" : "中"}</span>
    </button>
    <button
      class="icon-button compact-icon"
      type="button"
      aria-label={theme === "light" ? copy.header.themeDark : copy.header.themeLight}
      onclick={onToggleTheme}
    >
      {#if theme === "light"}<Moon size={18} aria-hidden="true" />{:else}<Sun
          size={18}
          aria-hidden="true"
        />{/if}
    </button>
    <a class="desktop-link" href="/#download">
      <MonitorDown size={17} aria-hidden="true" />{copy.header.desktop}
    </a>
  </div>
</header>
