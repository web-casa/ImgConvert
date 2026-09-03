<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import FileText from "@lucide/svelte/icons/file-text";
  import Scale from "@lucide/svelte/icons/scale";
  import { links, translations, type Locale } from "./lib/content";
  import { legalContent } from "./lib/legal";

  const locale: Locale = window.location.pathname.startsWith("/en") ? "en" : "zh";
  const copy = legalContent[locale];
  const homeUrl = locale === "zh" ? "/" : "/en/";
  const privacyUrl = locale === "zh" ? links.privacyZh : links.privacyEn;
  const legalUrl = locale === "zh" ? "/legal/" : "/en/legal/";
  const docsUrl = locale === "zh" ? links.docsZh : links.docsEn;
  const blogUrl = locale === "zh" ? links.blogZh : links.blogEn;
  const siteCopy = translations[locale];
  const navigationLabel = locale === "zh" ? "法律页面导航" : "Legal pages navigation";
  const footerLabel = locale === "zh" ? "页脚导航" : "Footer navigation";
</script>

<a class="skip-link" href="#main-content">{copy.common.skip}</a>

<div class="legal-shell">
  <header class="legal-topbar">
    <a class="brand" href={homeUrl} aria-label="ImgConvert home">
      <img
        class="brand-logo"
        src="/images/product/app-icon.png"
        alt=""
        width="30"
        height="30"
        aria-hidden="true"
      />
      <span class="brand-name">ImgConvert</span>
    </a>
    <nav class="legal-nav" aria-label={navigationLabel}>
      <a href={homeUrl}>{copy.common.home}</a>
      <a href={privacyUrl}>{copy.common.privacy}</a>
      <a class="active" href={legalUrl} aria-current="page">{copy.common.legal}</a>
      <a href={links.webApp}>{copy.common.webApp}</a>
      <span class="language-switch" aria-label={copy.common.language}>
        <a
          class:active={locale === "zh"}
          href="/legal/"
          lang="zh-CN"
          aria-current={locale === "zh" ? "page" : undefined}>中</a
        >
        <span aria-hidden="true">/</span>
        <a
          class:active={locale === "en"}
          href="/en/legal/"
          lang="en"
          aria-current={locale === "en" ? "page" : undefined}>EN</a
        >
      </span>
    </nav>
  </header>

  <main class="legal-main" id="main-content">
    <section class="legal-hero section-grid legal-hero-compact">
      <div>
        <p class="eyebrow">{copy.legal.eyebrow}</p>
        <h1>{copy.legal.title}</h1>
        <p>{copy.legal.intro}</p>
      </div>
      <aside class="legal-note">
        <Scale size={21} strokeWidth={1.9} aria-hidden="true" />
        <p>{copy.legal.note}</p>
      </aside>
    </section>

    <section class="legal-resources section-grid" aria-label={copy.common.legal}>
      {#each copy.legal.sections as section, index (section.title)}
        <article>
          <span>0{index + 1}</span>
          <FileText size={21} strokeWidth={1.9} aria-hidden="true" />
          <h2>{section.title}</h2>
          <p>{section.body}</p>
          <a
            class="inline-link dark-link"
            href={links[section.linkKey]}
            target="_blank"
            rel="noreferrer"
          >
            {section.linkLabel}<ArrowUpRight size={16} strokeWidth={2.1} aria-hidden="true" />
          </a>
        </article>
      {/each}
    </section>

    <a class="legal-return section-grid" href={homeUrl}>
      <ArrowLeft size={17} strokeWidth={2.1} aria-hidden="true" />{copy.common.home}
    </a>
  </main>

  <footer class="footer content-footer">
    <div class="footer-brand">
      <a class="brand" href={homeUrl} aria-label="ImgConvert home" translate="no">
        <img
          class="brand-logo"
          src="/images/product/app-icon.png"
          alt=""
          width="30"
          height="30"
          aria-hidden="true"
        />
        <span class="brand-name">ImgConvert</span>
      </a>
      <p>{siteCopy.footer.tagline}</p>
    </div>
    <nav class="footer-links" aria-label={footerLabel}>
      <a href={docsUrl}>{siteCopy.footer.docs}</a>
      <a href={blogUrl}>{siteCopy.footer.blog}</a>
      <a href={privacyUrl}>{siteCopy.footer.privacy}</a>
      <a href={legalUrl}>{siteCopy.footer.legal}</a>
      <a href={links.webApp}>{siteCopy.footer.webApp}</a>
      <a href={links.repository} target="_blank" rel="noreferrer">GitHub</a>
    </nav>
  </footer>
</div>
