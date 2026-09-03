<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Download from "@lucide/svelte/icons/download";
  import Menu from "@lucide/svelte/icons/menu";
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";
  import X from "@lucide/svelte/icons/x";
  import { tick } from "svelte";

  import appIconUrl from "../../../src/lib/assets/app-icon.png";
  import type { Locale } from "./copy";
  import {
    externalSiteLinks,
    localizedHome,
    localizedHomeSection,
    localizedWebApp,
  } from "./site-links";
  import type { Copy, Theme } from "./workbench";

  let {
    copy,
    locale,
    theme,
    onSetLocale,
    onToggleTheme,
  }: {
    copy: Copy;
    locale: Locale;
    theme: Theme;
    onSetLocale: (locale: Locale) => void;
    onToggleTheme: () => void;
  } = $props();

  let menuOpen = $state(false);
  let menuElement: HTMLElement;
  let menuToggle: HTMLButtonElement;

  function closeMenu(): void {
    menuOpen = false;
  }

  async function toggleMenu(): Promise<void> {
    menuOpen = !menuOpen;
    if (!menuOpen) return;
    await tick();
    menuElement.querySelector<HTMLAnchorElement>("a")?.focus();
  }

  async function handleKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key !== "Escape" || !menuOpen) return;
    closeMenu();
    await tick();
    menuToggle.focus();
  }

  function selectLocale(event: MouseEvent, nextLocale: Locale): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSetLocale(nextLocale);
    closeMenu();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<header class="app-header">
  <div class="app-nav-shell">
    <a class="app-brand" href={localizedHome(locale)} aria-label={copy.header.home} translate="no">
      <img src={appIconUrl} alt="" width="30" height="30" aria-hidden="true" />
      <span>ImgConvert</span>
    </a>

    <nav
      class:open={menuOpen}
      class="app-primary-nav"
      id="app-primary-nav"
      aria-label={copy.header.primaryLabel}
      bind:this={menuElement}
    >
      <a href={localizedHomeSection(locale, "features")} onclick={closeMenu}
        >{copy.header.product}</a
      >
      <a href={localizedHomeSection(locale, "formats")} onclick={closeMenu}>{copy.header.formats}</a
      >
      <a href={localizedHomeSection(locale, "guides")} onclick={closeMenu}>{copy.header.guides}</a>
      <a href={localizedHomeSection(locale, "faq")} onclick={closeMenu}>{copy.header.faq}</a>
      <a href={localizedWebApp(locale)} aria-current="page" onclick={closeMenu}
        >{copy.header.webApp}</a
      >
      <a href={externalSiteLinks.repository} target="_blank" rel="noreferrer" onclick={closeMenu}
        >{copy.header.github}<ArrowUpRight size={14} strokeWidth={2.1} aria-hidden="true" /></a
      >
    </nav>

    <div class="app-nav-actions">
      <nav class="app-language" aria-label={copy.header.languageLabel}>
        <a
          class:active={locale === "zh"}
          href={localizedWebApp("zh")}
          lang="zh-CN"
          aria-current={locale === "zh" ? "page" : undefined}
          onclick={(event) => selectLocale(event, "zh")}>中</a
        >
        <span aria-hidden="true">/</span>
        <a
          class:active={locale === "en"}
          href={localizedWebApp("en")}
          lang="en"
          aria-current={locale === "en" ? "page" : undefined}
          onclick={(event) => selectLocale(event, "en")}>EN</a
        >
      </nav>
      <button
        class="app-theme-toggle"
        type="button"
        aria-label={theme === "light" ? copy.header.themeDark : copy.header.themeLight}
        onclick={onToggleTheme}
      >
        {#if theme === "light"}
          <Moon size={18} aria-hidden="true" />
        {:else}
          <Sun size={18} aria-hidden="true" />
        {/if}
      </button>
      <a class="app-nav-download" href={localizedHomeSection(locale, "download")}>
        {copy.header.download}<Download size={15} strokeWidth={2.2} aria-hidden="true" />
      </a>
      <button
        class="app-menu-toggle"
        type="button"
        aria-label={menuOpen ? copy.header.close : copy.header.menu}
        aria-controls="app-primary-nav"
        aria-expanded={menuOpen}
        bind:this={menuToggle}
        onclick={toggleMenu}
      >
        {#if menuOpen}
          <X size={21} strokeWidth={2.2} aria-hidden="true" />
        {:else}
          <Menu size={22} strokeWidth={2.2} aria-hidden="true" />
        {/if}
      </button>
    </div>
  </div>
</header>
