<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Download from "@lucide/svelte/icons/download";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Globe from "@lucide/svelte/icons/globe";
  import Menu from "@lucide/svelte/icons/menu";
  import MonitorDown from "@lucide/svelte/icons/monitor-down";
  import Puzzle from "@lucide/svelte/icons/puzzle";
  import ScanSearch from "@lucide/svelte/icons/scan-search";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import X from "@lucide/svelte/icons/x";
  import { tick } from "svelte";
  import {
    links,
    masUrl,
    releaseUrl,
    snapUrl,
    storeUrl,
    translations,
    type Locale,
  } from "./lib/content";
  import { guideContent, guideIds, guidePaths } from "./lib/guides";
  import { homeContent } from "./lib/home";
  import "./home.css";

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
  let tryMenuOpen = $state(false);
  let downloadStatus = $state("");
  let menuElement: HTMLElement;
  let menuToggle: HTMLButtonElement;
  let tryMenuToggle: HTMLButtonElement;
  let latestReleaseRequest:
    Promise<{ assets: Array<{ name: string; browser_download_url: string }> }> | undefined;

  const copy = $derived(translations[locale]);
  const ui = $derived(homeContent[locale]);
  const guideCopy = $derived(guideContent[locale]);
  const localePrivacyUrl = $derived(locale === "zh" ? links.privacyZh : links.privacyEn);
  const localeLegalUrl = $derived(locale === "zh" ? links.legalZh : links.legalEn);
  const localeDocsUrl = $derived(locale === "zh" ? links.docsZh : links.docsEn);
  const localeBlogUrl = $derived(locale === "zh" ? links.blogZh : links.blogEn);
  const detectedPlatform = detectDownloadPlatform();
  const heroScreenshot = $derived(locale === "zh" ? "100-zh" : "100");
  const darkScreenshot = $derived(locale === "zh" ? "101-zh" : "101");
  const platformLogos = [
    "/images/platforms/apple.svg",
    "/images/platforms/windows.svg",
    "/images/platforms/linux.svg",
  ] as const;
  const quickDownloads = $derived([
    {
      platform: copy.downloads.items[0].platform,
      channel: copy.footer.macStore,
      href: masUrl,
      logo: platformLogos[0],
    },
    {
      platform: copy.downloads.items[1].platform,
      channel: copy.footer.store,
      href: storeUrl,
      logo: platformLogos[1],
    },
    {
      platform: "Linux",
      channel: "Snap Store",
      href: snapUrl,
      logo: platformLogos[2],
    },
  ]);
  const platformCards = $derived([
    { ...ui.platforms[0], href: "#download", external: false },
    { ...ui.platforms[1], href: links.webApp, external: false },
    { ...ui.platforms[2], href: "#browser-extension", external: false },
  ]);
  const downloadCards = $derived([
    {
      key: "macos" as const,
      title: copy.downloads.items[0].platform,
      detail: copy.downloads.items[0].detail,
      logo: platformLogos[0],
      actions: [{ label: copy.footer.macStore, href: masUrl }],
      directDownloads: [
        {
          format: "DMG",
          links: [
            { label: "x64", assetPattern: /^ImgConvert_[^_]+_x64\.dmg$/ },
            { label: "arm64", assetPattern: /^ImgConvert_[^_]+_aarch64\.dmg$/ },
          ],
        },
      ],
    },
    {
      key: "windows" as const,
      title: copy.downloads.items[1].platform,
      detail: copy.downloads.items[1].detail,
      logo: platformLogos[1],
      actions: [{ label: copy.footer.store, href: storeUrl, badge: ui.recommendedStore }],
      directDownloads: [
        {
          format: "EXE",
          links: [
            { label: "x64", assetPattern: /^ImgConvert_[^_]+_x64-setup\.exe$/ },
            { label: "arm64", assetPattern: /^ImgConvert_[^_]+_arm64-setup\.exe$/ },
          ],
        },
        {
          format: "MSI",
          links: [
            {
              label: "x64",
              assetPattern:
                locale === "zh"
                  ? /^ImgConvert_[^_]+_x64_zh-CN\.msi$/
                  : /^ImgConvert_[^_]+_x64_en-US\.msi$/,
            },
            {
              label: "arm64",
              assetPattern:
                locale === "zh"
                  ? /^ImgConvert_[^_]+_arm64_zh-CN\.msi$/
                  : /^ImgConvert_[^_]+_arm64_en-US\.msi$/,
            },
          ],
        },
      ],
    },
    {
      key: "linux" as const,
      title: "Linux",
      detail: copy.downloads.items[2].detail,
      logo: platformLogos[2],
      actions: [{ label: "Snap Store", href: snapUrl }],
      directDownloads: [
        {
          format: "AppImage",
          links: [
            { label: "amd64", assetPattern: /^ImgConvert_[^_]+_amd64\.AppImage$/ },
            { label: "arm64", assetPattern: /^ImgConvert_[^_]+_aarch64\.AppImage$/ },
          ],
        },
        {
          format: "DEB",
          links: [
            { label: "amd64", assetPattern: /^ImgConvert_[^_]+_amd64\.deb$/ },
            { label: "arm64", assetPattern: /^ImgConvert_[^_]+_arm64\.deb$/ },
          ],
        },
        {
          format: "RPM",
          links: [
            { label: "x86_64", assetPattern: /^ImgConvert-[^-]+-1\.x86_64\.rpm$/ },
            { label: "aarch64", assetPattern: /^ImgConvert-[^-]+-1\.aarch64\.rpm$/ },
          ],
        },
      ],
    },
  ]);

  function closeMenu() {
    menuOpen = false;
  }

  function openTryMenu() {
    tryMenuOpen = true;
  }

  function closeTryMenu() {
    tryMenuOpen = false;
  }

  function toggleTryMenu() {
    tryMenuOpen = !tryMenuOpen;
  }

  async function toggleMenu() {
    menuOpen = !menuOpen;

    if (menuOpen) {
      await tick();
      menuElement.querySelector<HTMLAnchorElement>("a")?.focus();
    }
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;

    if (tryMenuOpen) {
      closeTryMenu();
      await tick();
      tryMenuToggle.focus();
      return;
    }

    if (!menuOpen) return;

    closeMenu();
    await tick();
    menuToggle.focus();
  }

  async function resolveLatestAsset(event: MouseEvent, assetPattern: RegExp) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    downloadStatus = ui.resolvingDownload;

    try {
      latestReleaseRequest ??= fetch(
        "https://api.github.com/repos/web-casa/ImgConvert/releases/latest",
        { headers: { Accept: "application/vnd.github+json" } },
      ).then(async (response) => {
        if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
        return response.json();
      });

      const release = await latestReleaseRequest;
      const asset = release.assets.find((candidate) => assetPattern.test(candidate.name));
      if (!asset) throw new Error(`No asset matched ${assetPattern.source}`);

      window.location.assign(asset.browser_download_url);
    } catch {
      downloadStatus = ui.downloadFallback;
      window.location.assign(releaseUrl);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<a class="skip-link" href="#main-content">{copy.nav.skip}</a>
<p class="home-status-live" aria-live="polite">{downloadStatus}</p>

<div class="home-page" id="top">
  <header class="home-header">
    <div class="home-nav-shell">
      <a
        class="home-brand"
        href={locale === "zh" ? "/" : "/en/"}
        aria-label={ui.nav.homeLabel}
        translate="no"
      >
        <img
          class="home-brand-logo"
          src="/images/product/app-icon.png"
          alt=""
          width="30"
          height="30"
          aria-hidden="true"
        />
        <span>ImgConvert</span>
      </a>

      <nav
        class:open={menuOpen}
        class="home-nav"
        id="home-primary-nav"
        aria-label={ui.nav.primaryLabel}
        bind:this={menuElement}
      >
        <a href="#features" onclick={closeMenu}>{ui.nav.product}</a>
        <a href="#download" onclick={closeMenu}>{ui.nav.desktop}</a>
        <a href={links.webApp} onclick={closeMenu}>{ui.nav.webApp}</a>
        <a href="#browser-extension" onclick={closeMenu}>{ui.nav.extension}</a>
        <a href="#formats" onclick={closeMenu}>{ui.nav.formats}</a>
        <a href="#guides" onclick={closeMenu}>{ui.nav.guides}</a>
        <a href="#faq" onclick={closeMenu}>{ui.nav.faq}</a>
      </nav>

      <div class="home-nav-actions">
        <nav class="home-language" aria-label={ui.nav.languageLabel}>
          <a
            class:active={locale === "zh"}
            href="/"
            lang="zh-CN"
            aria-current={locale === "zh" ? "page" : undefined}>中</a
          >
          <span aria-hidden="true">/</span>
          <a
            class:active={locale === "en"}
            href="/en/"
            lang="en"
            aria-current={locale === "en" ? "page" : undefined}>EN</a
          >
        </nav>
        <div
          class="home-nav-try"
          role="group"
          aria-label={ui.navTryNowLabel}
          onmouseenter={openTryMenu}
          onmouseleave={closeTryMenu}
        >
          <button
            class="home-nav-download home-nav-try-toggle"
            type="button"
            aria-haspopup="menu"
            aria-expanded={tryMenuOpen}
            aria-controls="home-nav-try-menu"
            bind:this={tryMenuToggle}
            onclick={toggleTryMenu}
          >
            {ui.navTryNow}<ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
          {#if tryMenuOpen}
            <div
              class="home-nav-try-menu"
              id="home-nav-try-menu"
              role="menu"
              aria-label={ui.navTryNowLabel}
            >
              <a role="menuitem" href="#download" onclick={closeTryMenu}>
                <Download size={16} strokeWidth={2.1} aria-hidden="true" />
                <span><strong>{ui.navTryDesktop}</strong><small>{ui.desktopEntryNote}</small></span>
              </a>
              <a role="menuitem" href={links.webApp} onclick={closeTryMenu}>
                <Globe size={16} strokeWidth={2.1} aria-hidden="true" />
                <span><strong>{ui.navTryWeb}</strong><small>{ui.webEntryNote}</small></span>
              </a>
              <a role="menuitem" href="#browser-extension" onclick={closeTryMenu}>
                <Puzzle size={16} strokeWidth={2.1} aria-hidden="true" />
                <span
                  ><strong>{ui.navTryExtension}</strong><small>{ui.extensionEntryNote}</small></span
                >
              </a>
            </div>
          {/if}
        </div>
        <button
          class="home-menu-toggle"
          type="button"
          aria-label={menuOpen ? copy.nav.close : copy.nav.menu}
          aria-controls="home-primary-nav"
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

  <main id="main-content" tabindex="-1">
    <section class="home-hero" aria-labelledby="home-hero-title">
      <div class="home-hero-copy home-reveal">
        <p class="home-pill"><span></span>{ui.localBadge}</p>
        <h1 id="home-hero-title">
          <span>{copy.hero.titleBefore}</span>
          <em>{copy.hero.titleEm}</em>
        </h1>
        <p>{copy.hero.body}</p>
        <div class="home-hero-actions">
          <nav class="home-platform-links" aria-label={copy.downloads.title}>
            {#each quickDownloads as item (item.platform)}
              <a href={item.href} target="_blank" rel="noreferrer">
                <img src={item.logo} alt="" width="25" height="25" aria-hidden="true" />
                <span><strong>{item.platform}</strong><small>{item.channel}</small></span>
              </a>
            {/each}
          </nav>
          <div class="home-channel-actions">
            <a class="home-web-launch" href={links.webApp}>
              <Globe size={17} strokeWidth={2.1} aria-hidden="true" />
              <span><strong>{ui.webEntryAction}</strong><small>{ui.webEntryNote}</small></span>
              <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </a>
            <a class="home-extension-launch" href="#browser-extension">
              <Puzzle size={17} strokeWidth={2.1} aria-hidden="true" />
              <span
                ><strong>{ui.extensionEntryAction}</strong><small>{ui.extensionEntryNote}</small
                ></span
              >
              <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </a>
            <a class="home-all-downloads" href="#download">
              {copy.hero.allDownloads}<ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      <div class="home-hero-stage">
        <span class="home-ring home-ring-one" aria-hidden="true"></span>
        <span class="home-ring home-ring-two" aria-hidden="true"></span>
        <span class="home-ring home-ring-three" aria-hidden="true"></span>
        <div class="home-stage-chip home-stage-chip-left" aria-hidden="true">PNG</div>
        <div class="home-stage-chip home-stage-chip-right" aria-hidden="true">AVIF</div>
        <figure class="home-product-window">
          <picture>
            <source
              srcset={`/images/product/screenshots/${heroScreenshot}.avif`}
              type="image/avif"
            />
            <source
              srcset={`/images/product/screenshots/${heroScreenshot}.webp`}
              type="image/webp"
            />
            <img
              src={`/images/product/screenshots/${heroScreenshot}.png`}
              alt={copy.hero.visualAlt}
              width="2088"
              height="1378"
              fetchpriority="high"
              decoding="async"
            />
          </picture>
        </figure>
      </div>
    </section>

    <section class="home-trust home-container" aria-label={ui.trustTitle}>
      <p>{ui.trustTitle}</p>
      <ul>
        {#each ui.trustItems as item, index (item)}
          <li>
            {#if index < platformLogos.length}
              <img src={platformLogos[index]} alt="" width="18" height="18" aria-hidden="true" />
            {:else}
              <ShieldCheck size={18} strokeWidth={2.2} aria-hidden="true" />
            {/if}
            {item}
          </li>
        {/each}
      </ul>
    </section>

    <section class="home-product home-container" id="features" aria-labelledby="home-product-title">
      <div class="home-section-heading">
        <p class="home-eyebrow">{ui.metricsEyebrow}</p>
        <h2 id="home-product-title">{ui.metricsTitle}</h2>
        <p>{ui.metricsBody}</p>
      </div>

      <div class="home-metrics">
        {#each ui.metrics as metric (metric.label)}
          <article>
            <strong>{metric.value}</strong>
            <h3>{metric.label}</h3>
            <p>{metric.detail}</p>
          </article>
        {/each}
      </div>

      <div class="home-bento">
        <article class="home-bento-card home-bento-ui">
          <div class="home-bento-copy">
            <p class="home-card-label">{ui.realUi}</p>
            <h3>{copy.tour.title}</h3>
            <p>{copy.tour.body}</p>
          </div>
          <figure class="home-bento-screenshot">
            <picture>
              <source srcset="/images/product/screenshots/102.avif" type="image/avif" />
              <source srcset="/images/product/screenshots/102.webp" type="image/webp" />
              <img
                src="/images/product/screenshots/102.png"
                alt={copy.tour.pickerAlt}
                width="2088"
                height="1378"
                loading="lazy"
                decoding="async"
              />
            </picture>
          </figure>
        </article>

        <article class="home-bento-card home-bento-privacy" id="privacy">
          <div class="home-bento-copy">
            <span class="home-card-icon"
              ><ShieldCheck size={21} strokeWidth={2.1} aria-hidden="true" /></span
            >
            <p class="home-card-label">{ui.privacy}</p>
            <h3>{copy.proof.title}</h3>
            <p>{copy.proof.body}</p>
          </div>
          <figure>
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
          </figure>
          <ul>
            {#each copy.proof.points as point (point)}
              <li><Check size={15} strokeWidth={2.6} aria-hidden="true" />{point}</li>
            {/each}
          </ul>
        </article>

        <article class="home-bento-card home-bento-workflow">
          <div class="home-bento-copy">
            <p class="home-card-label">{ui.workflow}</p>
            <h3>{copy.features.title}</h3>
            <p>{copy.features.body}</p>
          </div>
          <ol>
            {#each copy.features.cards as card, index (card.number)}
              <li>
                <span class="home-step-icon" aria-hidden="true">
                  {#if index === 0}
                    <FolderOpen size={19} strokeWidth={2} />
                  {:else if index === 1}
                    <Settings2 size={19} strokeWidth={2} />
                  {:else}
                    <ScanSearch size={19} strokeWidth={2} />
                  {/if}
                </span>
                <div>
                  <small>{card.number}</small><strong>{card.title}</strong>
                  <p>{card.body}</p>
                </div>
              </li>
            {/each}
          </ol>
        </article>

        <article class="home-bento-card home-bento-formats" id="formats">
          <div class="home-bento-copy">
            <p class="home-card-label">{ui.formats}</p>
            <h3>{copy.formats.title}</h3>
            <p>{copy.formats.body}</p>
          </div>
          <div class="home-format-orbit" aria-hidden="true">
            <span>AVIF</span><span>WebP</span><span>JPEG</span><span>PNG</span>
            <i></i>
          </div>
          <ul>
            {#each copy.formats.list as item (item.format)}
              <li>
                <strong>{item.format}</strong><span>{item.detail}</span>
              </li>
            {/each}
          </ul>
          <div class="home-input-formats">
            <span>{ui.inputFormatsLabel}</span>
            {#each ["PDF", "SVG", "HEIC"] as format (format)}
              <strong translate="no">{format}</strong>
            {/each}
          </div>
        </article>
      </div>

      <div class="home-product-gallery" aria-labelledby="home-gallery-title">
        <div class="home-gallery-heading">
          <p class="home-eyebrow">{ui.productGalleryEyebrow}</p>
          <h3 id="home-gallery-title">{ui.productGalleryTitle}</h3>
          <p>{ui.productGalleryBody}</p>
        </div>
        <div class="home-screenshot-grid">
          <figure class="home-shot home-shot-dark">
            <picture>
              <source
                srcset={`/images/product/screenshots/${darkScreenshot}.avif`}
                type="image/avif"
              />
              <source
                srcset={`/images/product/screenshots/${darkScreenshot}.webp`}
                type="image/webp"
              />
              <img
                src={`/images/product/screenshots/${darkScreenshot}.png`}
                alt={ui.screenshots.dark.alt}
                width="2088"
                height="1378"
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>
              <strong>{ui.screenshots.dark.title}</strong><span>{ui.screenshots.dark.body}</span>
            </figcaption>
          </figure>
          <figure class="home-shot">
            <picture>
              <source srcset="/images/product/screenshots/103.avif" type="image/avif" />
              <source srcset="/images/product/screenshots/103.webp" type="image/webp" />
              <img
                src="/images/product/screenshots/103.png"
                alt={ui.screenshots.presets.alt}
                width="2088"
                height="1378"
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>
              <strong>{ui.screenshots.presets.title}</strong><span
                >{ui.screenshots.presets.body}</span
              >
            </figcaption>
          </figure>
          <figure class="home-shot">
            <picture>
              <source srcset="/images/product/screenshots/104.avif" type="image/avif" />
              <source srcset="/images/product/screenshots/104.webp" type="image/webp" />
              <img
                src="/images/product/screenshots/104.png"
                alt={ui.screenshots.plugins.alt}
                width="2088"
                height="1378"
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>
              <strong>{ui.screenshots.plugins.title}</strong><span
                >{ui.screenshots.plugins.body}</span
              >
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section
      class="home-platforms home-container"
      id="platforms"
      aria-labelledby="home-platforms-title"
    >
      <div class="home-section-heading">
        <p class="home-eyebrow">{ui.platformsEyebrow}</p>
        <h2 id="home-platforms-title">{ui.platformsTitle}</h2>
        <p>{ui.platformsBody}</p>
      </div>

      <div class="home-platform-cards">
        {#each platformCards as platform, index (platform.name)}
          <article>
            <div class="home-platform-top">
              <span class="home-platform-icon" aria-hidden="true">
                {#if index === 0}
                  <MonitorDown size={19} strokeWidth={2} />
                {:else if index === 1}
                  <Globe size={19} strokeWidth={2} />
                {:else}
                  <Puzzle size={19} strokeWidth={2} />
                {/if}
              </span>
              <span class="home-platform-badge">{platform.badge}</span>
            </div>
            <h3>{platform.name}</h3>
            <p class="home-platform-tagline">{platform.tagline}</p>
            <p class="home-platform-body">{platform.body}</p>
            {#if index === 2}
              <div class="home-extension-card-actions">
                <button type="button" disabled>
                  {ui.extensionStoreAction}<small>{ui.extensionStoreNote}</small>
                </button>
                {#if links.extensionChromeZip}
                  <a href={links.extensionChromeZip} target="_blank" rel="noreferrer">
                    {ui.extensionZipAction}<ArrowUpRight
                      size={15}
                      strokeWidth={2.2}
                      aria-hidden="true"
                    />
                  </a>
                {:else}
                  <button type="button" disabled
                    >{ui.extensionZipAction}<small>{ui.extensionZipNote}</small></button
                  >
                {/if}
                {#if links.extensionSource}
                  <a href={links.extensionSource} target="_blank" rel="noreferrer">
                    {ui.extensionSourceAction}<ArrowUpRight
                      size={15}
                      strokeWidth={2.2}
                      aria-hidden="true"
                    />
                  </a>
                {:else}
                  <button type="button" disabled
                    >{ui.extensionSourceAction}<small>{ui.extensionZipNote}</small></button
                  >
                {/if}
              </div>
            {:else if platform.external}
              <a href={platform.href} target="_blank" rel="noreferrer">
                {platform.action}<ArrowUpRight size={15} strokeWidth={2.2} aria-hidden="true" />
              </a>
            {:else}
              <a href={platform.href}>
                {platform.action}<ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
              </a>
            {/if}
          </article>
        {/each}
      </div>

      <div class="home-compare">
        <div class="home-section-heading">
          <p class="home-eyebrow">{ui.compareEyebrow}</p>
          <h3 id="home-compare-title">{ui.compareTitle}</h3>
        </div>
        <div class="home-compare-table" role="region" aria-labelledby="home-compare-title">
          <table>
            <thead>
              <tr>
                <th scope="col">{ui.compareHeaders.feature}</th>
                <th scope="col">{ui.compareHeaders.desktop}</th>
                <th scope="col">{ui.compareHeaders.web}</th>
                <th scope="col">{ui.compareHeaders.extension}</th>
              </tr>
            </thead>
            <tbody>
              {#each ui.compareRows as row (row.feature)}
                <tr>
                  <th scope="row">{row.feature}</th>
                  <td>{row.desktop}</td>
                  <td>{row.web}</td>
                  <td>{row.extension}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="home-compare-note">{ui.compareNote}</p>
      </div>
    </section>

    <section class="home-downloads" id="download" aria-labelledby="home-downloads-title">
      <div class="home-container">
        <div class="home-section-heading home-section-heading-light">
          <p class="home-eyebrow">{ui.downloadsEyebrow}</p>
          <h2 id="home-downloads-title">{copy.downloads.title}</h2>
          <p>{copy.downloads.body}</p>
        </div>

        <nav class="home-download-channels" aria-label={ui.channelNavLabel}>
          <a href="#desktop-downloads">
            <MonitorDown size={19} strokeWidth={2} aria-hidden="true" />
            <span><strong>{ui.desktopEntryAction}</strong><small>{ui.desktopEntryNote}</small></span
            >
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </a>
          <a href={links.webApp}>
            <Globe size={19} strokeWidth={2} aria-hidden="true" />
            <span><strong>{ui.webEntryAction}</strong><small>{ui.webEntryNote}</small></span>
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </a>
          <a href="#browser-extension">
            <Puzzle size={19} strokeWidth={2} aria-hidden="true" />
            <span
              ><strong>{ui.extensionEntryAction}</strong><small>{ui.extensionEntryNote}</small
              ></span
            >
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </a>
        </nav>

        <div class="home-download-grid" id="desktop-downloads">
          {#each downloadCards as card (card.key)}
            <article class:recommended={card.key === detectedPlatform}>
              {#if card.key === detectedPlatform}
                <p class="home-recommended"><span></span>{ui.recommended}</p>
              {/if}
              <span class="home-download-icon">
                <img src={card.logo} alt="" width="25" height="25" aria-hidden="true" />
              </span>
              <h3>{card.title}</h3>
              <p>{card.detail}</p>
              <div class="home-download-actions">
                {#each card.actions as action (action.href)}
                  <a href={action.href} target="_blank" rel="noreferrer">
                    <span>
                      {action.label}
                      {#if "badge" in action && action.badge}
                        <small class="home-store-badge">{action.badge}</small>
                      {/if}
                    </span>
                    <ArrowUpRight size={15} strokeWidth={2.2} aria-hidden="true" />
                  </a>
                {/each}
              </div>
              {#if card.directDownloads.length}
                <div class="home-direct-downloads">
                  <p>
                    {ui.githubPackages}<span translate="no">Latest</span>
                  </p>
                  {#each card.directDownloads as group (group.format)}
                    <div>
                      <strong translate="no">{group.format}</strong>
                      {#each group.links as direct (direct.label)}
                        <a
                          href={releaseUrl}
                          target="_blank"
                          rel="noreferrer"
                          translate="no"
                          aria-label={`${group.format} ${direct.label} · GitHub Latest`}
                          onclick={(event) => resolveLatestAsset(event, direct.assetPattern)}
                        >
                          {direct.label}<ArrowUpRight
                            size={13}
                            strokeWidth={2.2}
                            aria-hidden="true"
                          />
                        </a>
                      {/each}
                    </div>
                  {/each}
                </div>
              {/if}
              {#if card.key === "linux"}<small>{ui.linuxAlternatives}</small>{/if}
            </article>
          {/each}
        </div>

        <article
          class="home-extension-install"
          id="browser-extension"
          aria-labelledby="home-extension-install-title"
        >
          <div class="home-extension-install-copy">
            <span class="home-extension-install-icon" aria-hidden="true">
              <Puzzle size={25} strokeWidth={1.9} />
            </span>
            <div>
              <p class="home-eyebrow">CHROME · EDGE</p>
              <h3 id="home-extension-install-title">{ui.extensionManualTitle}</h3>
              <p>{ui.extensionManualBody}</p>
            </div>
          </div>
          <div class="home-extension-install-actions">
            <button type="button" disabled>
              <span>{ui.extensionStoreAction}<small>{ui.extensionStoreNote}</small></span>
            </button>
            {#if links.extensionChromeZip}
              <a href={links.extensionChromeZip} target="_blank" rel="noreferrer">
                <span
                  ><strong>{ui.extensionZipAction}</strong><small>{ui.extensionZipNote}</small
                  ></span
                >
                <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
              </a>
            {:else}
              <button type="button" disabled
                >{ui.extensionZipAction}<small>{ui.extensionZipNote}</small></button
              >
            {/if}
            {#if links.extensionSource}
              <a href={links.extensionSource} target="_blank" rel="noreferrer">
                <span><strong>{ui.extensionSourceAction}</strong><small>GitHub</small></span>
                <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
              </a>
            {:else}
              <button type="button" disabled
                >{ui.extensionSourceAction}<small>{ui.extensionZipNote}</small></button
              >
            {/if}
          </div>
        </article>

        <div class="home-linux-support">
          <div class="home-linux-copy">
            <span class="home-linux-logo">
              <img src={platformLogos[2]} alt="" width="38" height="38" aria-hidden="true" />
            </span>
            <div>
              <p class="home-eyebrow">{ui.linuxEyebrow}</p>
              <h3>{ui.linuxTitle}</h3>
              <p>{ui.linuxBody}</p>
            </div>
          </div>
          <ul aria-label={ui.linuxTitle}>
            {#each ui.linuxDistros as distro (distro)}
              <li translate="no">
                <Check size={13} strokeWidth={2.6} aria-hidden="true" />{distro}
              </li>
            {/each}
          </ul>
        </div>

        <div class="home-download-trust">
          {#each copy.downloads.trust as item (item)}
            <span><Check size={14} strokeWidth={2.7} aria-hidden="true" />{item}</span>
          {/each}
          <a href={releaseUrl} target="_blank" rel="noreferrer">
            {copy.downloads.releaseNotes}<ArrowUpRight
              size={15}
              strokeWidth={2.1}
              aria-hidden="true"
            />
          </a>
        </div>
      </div>
    </section>

    <section
      class="home-resources home-container"
      id="guides"
      aria-labelledby="home-resources-title"
    >
      <div class="home-section-heading">
        <p class="home-eyebrow">{ui.resourcesEyebrow}</p>
        <h2 id="home-resources-title">{ui.resourcesTitle}</h2>
        <p>{ui.resourcesBody}</p>
      </div>

      <div class="home-guide-list">
        {#each guideIds as guideId (guideId)}
          {@const guide = guideCopy.pages[guideId]}
          <a href={guidePaths[locale][guideId]}>
            <span>{guide.platform}</span>
            <div>
              <h3>{guide.title}</h3>
              <p>{guide.lede}</p>
            </div>
            <strong
              >{ui.allGuides}<ArrowUpRight size={16} strokeWidth={2.1} aria-hidden="true" /></strong
            >
          </a>
        {/each}
      </div>

      <div class="home-resource-cards">
        <a href={localeDocsUrl}>
          <p>{copy.resources.docs.label}</p>
          <h3>{copy.resources.docs.title}</h3>
          <span>{copy.resources.docs.body}</span>
          <strong
            >{copy.resources.docs.action}<ArrowRight
              size={16}
              strokeWidth={2.1}
              aria-hidden="true"
            /></strong
          >
        </a>
        <a href={localeBlogUrl}>
          <p>{copy.resources.blog.label}</p>
          <h3>{copy.resources.blog.title}</h3>
          <span>{copy.resources.blog.body}</span>
          <strong
            >{copy.resources.blog.action}<ArrowRight
              size={16}
              strokeWidth={2.1}
              aria-hidden="true"
            /></strong
          >
        </a>
      </div>
    </section>

    <section class="home-faq home-container" id="faq" aria-labelledby="home-faq-title">
      <div class="home-section-heading">
        <p class="home-eyebrow">FAQ</p>
        <h2 id="home-faq-title">{copy.faq.title}</h2>
      </div>
      <div class="home-faq-list">
        {#each copy.faq.items as item, index (item.question)}
          <details open={index === 0}>
            <summary>{item.question}<span aria-hidden="true">+</span></summary>
            <p>{item.answer}</p>
          </details>
        {/each}
      </div>
    </section>

    <section class="home-final-cta home-container" aria-labelledby="home-final-title">
      <div class="home-final-orbit" aria-hidden="true">
        <span class="orbit-format orbit-format-a">AVIF</span>
        <span class="orbit-format orbit-format-b">WebP</span>
        <span class="orbit-format orbit-format-c">JPEG</span>
        <span class="orbit-format orbit-format-d">PNG</span>
        <span class="orbit-format orbit-format-e">HEIC</span>
        <i></i><i></i>
      </div>
      <div class="home-final-copy">
        <p class="home-eyebrow">{ui.finalEyebrow}</p>
        <h2 id="home-final-title"><span>{ui.finalTitleBefore}</span><em>{ui.finalTitleEm}</em></h2>
        <p>{ui.finalBody}</p>
        <nav
          class="home-platform-links home-platform-links-final"
          aria-label={copy.downloads.title}
        >
          {#each quickDownloads as item (item.platform)}
            <a href={item.href} target="_blank" rel="noreferrer">
              <img src={item.logo} alt="" width="25" height="25" aria-hidden="true" />
              <span><strong>{item.platform}</strong><small>{item.channel}</small></span>
            </a>
          {/each}
        </nav>
        <div class="home-channel-actions">
          <a class="home-web-launch" href={links.webApp}>
            <Globe size={17} strokeWidth={2.1} aria-hidden="true" />
            <span><strong>{ui.webEntryAction}</strong><small>{ui.webEntryNote}</small></span>
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </a>
          <a class="home-extension-launch" href="#browser-extension">
            <Puzzle size={17} strokeWidth={2.1} aria-hidden="true" />
            <span
              ><strong>{ui.extensionEntryAction}</strong><small>{ui.extensionEntryNote}</small
              ></span
            >
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </a>
          <a class="home-all-downloads" href="#download">
            {copy.hero.allDownloads}<ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  </main>

  <footer class="home-footer">
    <div class="home-container home-footer-grid">
      <div>
        <a
          class="home-brand"
          href={locale === "zh" ? "/" : "/en/"}
          aria-label={ui.nav.homeLabel}
          translate="no"
        >
          <img
            class="home-brand-logo"
            src="/images/product/app-icon.png"
            alt=""
            width="30"
            height="30"
            aria-hidden="true"
          />
          <span>ImgConvert</span>
        </a>
        <p>{copy.footer.tagline}</p>
      </div>
      <nav aria-label={ui.nav.footerLabel}>
        <a href="#download">{ui.desktopEntryAction}</a>
        <a href={links.webApp}>{copy.footer.webApp}</a>
        <a href="#browser-extension">{ui.extensionEntryAction}</a>
        <a href="#guides">{copy.footer.guides}</a>
        <a href={localeDocsUrl}>{copy.footer.docs}</a>
        <a href={localeBlogUrl}>{copy.footer.blog}</a>
        <a href={locale === "zh" ? "/environment/" : "/en/environment/"}
          >{locale === "zh" ? "存储与环境" : "Storage & environment"}</a
        >
        <a href={localePrivacyUrl}>{copy.footer.privacy}</a>
        <a href={localeLegalUrl}>{copy.footer.legal}</a>
        <a href={masUrl} target="_blank" rel="noreferrer">{copy.footer.macStore}</a>
        <a href={storeUrl} target="_blank" rel="noreferrer">{copy.footer.store}</a>
        <a href={links.repository} target="_blank" rel="noreferrer">{copy.footer.repository}</a>
        <a href="#top">{copy.footer.back} ↑</a>
      </nav>
    </div>
  </footer>
</div>
