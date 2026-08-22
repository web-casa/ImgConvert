<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Check from "@lucide/svelte/icons/check";
  import Download from "@lucide/svelte/icons/download";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import HardDriveDownload from "@lucide/svelte/icons/hard-drive-download";
  import Menu from "@lucide/svelte/icons/menu";
  import MonitorDown from "@lucide/svelte/icons/monitor-down";
  import ScanSearch from "@lucide/svelte/icons/scan-search";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import X from "@lucide/svelte/icons/x";
  import { links, releaseUrl, snapUrl, storeUrl, translations, type Locale } from "./lib/content";
  import { guideContent, guideIds, guidePaths } from "./lib/guides";

  type DownloadPlatform = "windows" | "macos" | "linux" | "other";

  const initialLocale: Locale = window.location.pathname.startsWith("/en") ? "en" : "zh";

  function detectDownloadPlatform(): DownloadPlatform {
    const fingerprint = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();

    if (/windows|win32|win64/.test(fingerprint)) return "windows";
    if (/iphone|ipad|ipod|android|mobile/.test(fingerprint)) return "other";
    if (/macintosh|mac os|macintel/.test(fingerprint)) return "macos";
    if (/linux|x11/.test(fingerprint)) return "linux";

    return "other";
  }

  let locale = $state<Locale>(initialLocale);
  let menuOpen = $state(false);

  const copy = $derived(translations[locale]);
  const guideCopy = $derived(guideContent[locale]);
  const localePrivacyUrl = $derived(locale === "zh" ? links.privacyZh : links.privacyEn);
  const localeLegalUrl = $derived(locale === "zh" ? links.legalZh : links.legalEn);
  const localeDocsUrl = $derived(locale === "zh" ? links.docsZh : links.docsEn);
  const localeBlogUrl = $derived(locale === "zh" ? links.blogZh : links.blogEn);
  const detectedPlatform = detectDownloadPlatform();
  const primaryDownload = $derived(copy.downloads.platformDownload[detectedPlatform]);
  const primaryDownloadExternal = $derived(primaryDownload.href.startsWith("http"));

  function closeMenu() {
    menuOpen = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") closeMenu();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<a class="skip-link" href="#main-content">{copy.nav.skip}</a>

<div class="site-shell" id="top">
  <header class="topbar">
    <a class="brand" href={locale === "zh" ? "/" : "/en/"} aria-label="ImgConvert home">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="brand-name">ImgConvert</span>
    </a>

    <nav class:open={menuOpen} class="site-nav" aria-label="Primary navigation">
      <a href="#features" onclick={closeMenu}>{copy.nav.features}</a>
      <a href="#guides" onclick={closeMenu}>{copy.nav.guides}</a>
      <a href={localeDocsUrl} onclick={closeMenu}>{copy.nav.docs}</a>
      <a href={localeBlogUrl} onclick={closeMenu}>{copy.nav.blog}</a>
      <a href="#privacy" onclick={closeMenu}>{copy.nav.local}</a>
      <a href="#faq" onclick={closeMenu}>{copy.nav.faq}</a>
      <div class="language-switch" aria-label="Language">
        <a class:active={locale === "zh"} href="/" lang="zh-CN">中</a>
        <span aria-hidden="true">/</span>
        <a class:active={locale === "en"} href="/en/" lang="en">EN</a>
      </div>
      <a
        class="nav-download"
        href={primaryDownload.href}
        target={primaryDownloadExternal ? "_blank" : undefined}
        rel={primaryDownloadExternal ? "noreferrer" : undefined}
        onclick={closeMenu}
      >
        {copy.nav.download}<Download size={15} strokeWidth={2.2} aria-hidden="true" />
      </a>
    </nav>

    <button
      class="menu-toggle"
      type="button"
      aria-label={menuOpen ? copy.nav.close : copy.nav.menu}
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      {#if menuOpen}
        <X size={21} strokeWidth={2.1} aria-hidden="true" />
      {:else}
        <Menu size={22} strokeWidth={2.1} aria-hidden="true" />
      {/if}
    </button>
  </header>

  <main id="main-content">
    <section class="hero section-grid">
      <div class="hero-copy reveal-up">
        <p class="hero-kicker">{copy.hero.eyebrow}</p>
        <h1><span>{copy.hero.titleBefore}</span><em>{copy.hero.titleEm}</em></h1>
        <p class="hero-body">{copy.hero.body}</p>
        <div class="hero-actions">
          <a
            class="button button-primary"
            href={primaryDownload.href}
            target={primaryDownloadExternal ? "_blank" : undefined}
            rel={primaryDownloadExternal ? "noreferrer" : undefined}
          >
            <Download size={18} strokeWidth={2.25} aria-hidden="true" />
            {primaryDownload.label}
          </a>
          <a class="button button-quiet" href="#download">
            {copy.hero.allDownloads}<ArrowRight size={16} strokeWidth={2.1} aria-hidden="true" />
          </a>
        </div>
        <p class="platform-note"><span></span>{copy.hero.note}</p>
      </div>

      <figure class="hero-product reveal-pop">
        <div class="product-window">
          <picture>
            <source srcset="/images/product/main-workspace.avif" type="image/avif" />
            <source srcset="/images/product/main-workspace.webp" type="image/webp" />
            <img
              src="/images/product/main-workspace.png"
              alt={copy.hero.visualAlt}
              width="2412"
              height="1468"
              fetchpriority="high"
              decoding="async"
            />
          </picture>
        </div>
        <figcaption>{copy.hero.caption}</figcaption>
      </figure>

      <ul class="hero-facts" aria-label="Product highlights">
        {#each copy.hero.tags as tag (tag)}
          <li><Check size={16} strokeWidth={2.6} aria-hidden="true" />{tag}</li>
        {/each}
      </ul>
    </section>

    <section class="proof section-grid" id="local" aria-labelledby="local-title">
      <div class="proof-copy">
        <h2 id="local-title">{copy.proof.title}</h2>
        <p>{copy.proof.body}</p>
      </div>
      <figure class="proof-visual">
        <picture>
          <source srcset="/images/generated/local-atelier.avif" type="image/avif" />
          <source srcset="/images/generated/local-atelier.webp" type="image/webp" />
          <img
            src="/images/generated/local-atelier.png"
            alt={copy.proof.visualAlt}
            width="1122"
            height="1402"
            loading="lazy"
            decoding="async"
          />
        </picture>
        <figcaption>{copy.proof.visualCaption}</figcaption>
      </figure>
      <ul class="proof-list">
        {#each copy.proof.points as point (point)}
          <li>
            <ShieldCheck size={20} strokeWidth={2.2} aria-hidden="true" /><span>{point}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section class="workflow" id="features" aria-labelledby="features-title">
      <div class="section-grid workflow-grid">
        <div class="section-heading heading-light">
          <p class="section-kicker">{copy.features.eyebrow}</p>
          <h2 id="features-title">{copy.features.title}</h2>
          <p>{copy.features.body}</p>
        </div>

        <ol class="workflow-steps">
          {#each copy.features.cards as card, index (card.number)}
            <li>
              <div class="step-symbol" aria-hidden="true">
                {#if index === 0}
                  <FolderOpen size={22} strokeWidth={2} />
                {:else if index === 1}
                  <Settings2 size={22} strokeWidth={2} />
                {:else}
                  <ScanSearch size={22} strokeWidth={2} />
                {/if}
              </div>
              <div class="step-content">
                <p class="step-number">{card.number}</p>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <div class="chips">
                  {#each card.chips as chip (chip)}<span>{chip}</span>{/each}
                </div>
              </div>
            </li>
          {/each}
        </ol>
      </div>
    </section>

    <section class="product-tour section-grid" aria-labelledby="tour-title">
      <div class="product-tour-copy">
        <p class="section-kicker">{copy.tour.eyebrow}</p>
        <h2 id="tour-title">{copy.tour.title}</h2>
        <p>{copy.tour.body}</p>
        <ul class="tour-list">
          {#each copy.tour.points as point (point)}
            <li><Check size={17} strokeWidth={2.5} aria-hidden="true" />{point}</li>
          {/each}
        </ul>
      </div>

      <div class="product-tour-visuals">
        <figure class="tour-workspace">
          <picture>
            <source srcset="/images/product/live-workspace.avif" type="image/avif" />
            <source srcset="/images/product/live-workspace.webp" type="image/webp" />
            <img
              src="/images/product/live-workspace.png"
              alt={copy.tour.workspaceAlt}
              width="900"
              height="680"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <figcaption>{copy.tour.workspaceCaption}</figcaption>
        </figure>
        <figure class="tour-format-picker">
          <picture>
            <source srcset="/images/product/format-picker.webp" type="image/webp" />
            <img
              src="/images/product/format-picker.png"
              alt={copy.tour.pickerAlt}
              width="2412"
              height="1468"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <figcaption>{copy.tour.pickerCaption}</figcaption>
        </figure>
      </div>
    </section>

    <section class="formats section-grid" aria-labelledby="formats-title">
      <div class="section-heading">
        <p class="section-kicker">{copy.formats.eyebrow}</p>
        <h2 id="formats-title">{copy.formats.title}</h2>
        <p>{copy.formats.body}</p>
      </div>
      <div class="format-list">
        {#each copy.formats.list as item, index (item.format)}
          <article class:format-primary={index === 0} class="format-row">
            <span class="format-no">0{index + 1}</span>
            <strong>{item.format}</strong>
            <span class="format-detail">{item.detail}</span>
            <ArrowRight size={19} strokeWidth={2} aria-hidden="true" />
          </article>
        {/each}
      </div>
    </section>

    <section class="guides section-grid" id="guides" aria-labelledby="guides-title">
      <div class="section-heading">
        <h2 id="guides-title">{guideCopy.common.homeTitle}</h2>
        <p>{guideCopy.common.homeBody}</p>
      </div>
      <div class="guide-list" aria-label={guideCopy.common.guides}>
        {#each guideIds as guideId (guideId)}
          {@const guide = guideCopy.pages[guideId]}
          <a class="guide-row" href={guidePaths[locale][guideId]}>
            <span class="guide-platform">{guide.platform}</span>
            <div>
              <h3>{guide.title}</h3>
              <p>{guide.lede}</p>
            </div>
            <ArrowUpRight size={20} strokeWidth={2.05} aria-hidden="true" />
          </a>
        {/each}
      </div>
    </section>

    <section class="resources section-grid" id="resources" aria-labelledby="resources-title">
      <div class="section-heading">
        <p class="section-kicker">{copy.resources.eyebrow}</p>
        <h2 id="resources-title">{copy.resources.title}</h2>
        <p>{copy.resources.body}</p>
      </div>
      <div class="resource-home-list">
        <a href={localeDocsUrl}>
          <span class="resource-home-no">01</span>
          <div>
            <p>{copy.resources.docs.label}</p>
            <h3>{copy.resources.docs.title}</h3>
            <span>{copy.resources.docs.body}</span>
          </div>
          <strong
            >{copy.resources.docs.action}<ArrowUpRight
              size={18}
              strokeWidth={2.1}
              aria-hidden="true"
            /></strong
          >
        </a>
        <a href={localeBlogUrl}>
          <span class="resource-home-no">02</span>
          <div>
            <p>{copy.resources.blog.label}</p>
            <h3>{copy.resources.blog.title}</h3>
            <span>{copy.resources.blog.body}</span>
          </div>
          <strong
            >{copy.resources.blog.action}<ArrowUpRight
              size={18}
              strokeWidth={2.1}
              aria-hidden="true"
            /></strong
          >
        </a>
      </div>
    </section>

    <section class="privacy section-grid" id="privacy" aria-labelledby="privacy-title">
      <div class="privacy-copy">
        <h2 id="privacy-title">{copy.privacy.title}</h2>
        <p>{copy.privacy.body}</p>
        <a class="inline-link" href={localePrivacyUrl}>
          {copy.privacy.action}<ArrowUpRight size={16} strokeWidth={2.1} aria-hidden="true" />
        </a>
      </div>
      <aside class="privacy-notes" aria-label={copy.privacy.title}>
        {#each copy.privacy.items as item, index (item)}
          <div>
            <span>0{index + 1}</span>
            <p>{item}</p>
          </div>
        {/each}
      </aside>
    </section>

    <section class="downloads" id="download" aria-labelledby="downloads-title">
      <div class="section-grid downloads-grid">
        <div class="downloads-heading">
          <h2 id="downloads-title">{copy.downloads.title}</h2>
          <p>{copy.downloads.body}</p>
        </div>
        <div class="download-list">
          {#each copy.downloads.items as item, index (item.platform)}
            <a class="download-row" href={item.href} target="_blank" rel="noreferrer">
              <span class="download-icon">
                {#if index === 0}
                  <MonitorDown size={21} strokeWidth={2} aria-hidden="true" />
                {:else if index === 1}
                  <Download size={21} strokeWidth={2} aria-hidden="true" />
                {:else}
                  <HardDriveDownload size={21} strokeWidth={2} aria-hidden="true" />
                {/if}
              </span>
              <span><strong>{item.platform}</strong><small>{item.detail}</small></span>
              <ArrowUpRight size={19} strokeWidth={2.1} aria-hidden="true" />
            </a>
          {/each}
        </div>
        <a
          class="button button-primary download-action"
          href={primaryDownload.href}
          target={primaryDownloadExternal ? "_blank" : undefined}
          rel={primaryDownloadExternal ? "noreferrer" : undefined}
        >
          <Download size={17} strokeWidth={2.1} aria-hidden="true" />
          {primaryDownload.label}
        </a>
        <div class="download-trust">
          <ul>
            {#each copy.downloads.trust as item (item)}
              <li><Check size={16} strokeWidth={2.6} aria-hidden="true" />{item}</li>
            {/each}
          </ul>
          <a href={releaseUrl} target="_blank" rel="noreferrer">
            {copy.downloads.releaseNotes}<ArrowUpRight
              size={16}
              strokeWidth={2.1}
              aria-hidden="true"
            />
          </a>
        </div>
      </div>
    </section>

    <section class="faq section-grid" id="faq" aria-labelledby="faq-title">
      <div class="section-heading">
        <h2 id="faq-title">{copy.faq.title}</h2>
      </div>
      <div class="faq-list">
        {#each copy.faq.items as item, index (item.question)}
          <details open={index === 0}>
            <summary>{item.question}<span aria-hidden="true">+</span></summary>
            <p>{item.answer}</p>
          </details>
        {/each}
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="footer-brand">
      <a class="brand" href={locale === "zh" ? "/" : "/en/"} aria-label="ImgConvert home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="brand-name">ImgConvert</span>
      </a>
      <p>{copy.footer.tagline}</p>
    </div>
    <div class="footer-links">
      <a href="#guides">{copy.footer.guides}</a>
      <a href={localeDocsUrl}>{copy.footer.docs}</a>
      <a href={localeBlogUrl}>{copy.footer.blog}</a>
      <a href={localePrivacyUrl}>{copy.footer.privacy}</a>
      <a href={localeLegalUrl}>{copy.footer.legal}</a>
      <a href={storeUrl} target="_blank" rel="noreferrer">{copy.footer.store}</a>
      <a href={snapUrl} target="_blank" rel="noreferrer">{copy.footer.snap}</a>
      <a href={links.repository} target="_blank" rel="noreferrer">{copy.footer.repository}</a>
      <a href="#top" onclick={closeMenu}>{copy.footer.back} ↑</a>
    </div>
  </footer>
</div>
