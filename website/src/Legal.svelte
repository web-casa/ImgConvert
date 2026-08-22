<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import FileText from "@lucide/svelte/icons/file-text";
  import Scale from "@lucide/svelte/icons/scale";
  import { links, type Locale } from "./lib/content";
  import { legalContent } from "./lib/legal";

  const locale: Locale = window.location.pathname.startsWith("/en") ? "en" : "zh";
  const copy = legalContent[locale];
  const homeUrl = locale === "zh" ? "/" : "/en/";
  const privacyUrl = locale === "zh" ? links.privacyZh : links.privacyEn;
  const legalUrl = locale === "zh" ? "/legal/" : "/en/legal/";
</script>

<a class="skip-link" href="#main-content">{copy.common.skip}</a>

<div class="legal-shell">
  <header class="legal-topbar">
    <a class="brand" href={homeUrl} aria-label="ImgConvert home">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="brand-name">ImgConvert</span>
    </a>
    <nav class="legal-nav" aria-label="Legal pages navigation">
      <a href={homeUrl}>{copy.common.home}</a>
      <a href={privacyUrl}>{copy.common.privacy}</a>
      <a class="active" href={legalUrl}>{copy.common.legal}</a>
      <span class="language-switch" aria-label={copy.common.language}>
        <a class:active={locale === "zh"} href="/legal/" lang="zh-CN">中</a>
        <span aria-hidden="true">/</span>
        <a class:active={locale === "en"} href="/en/legal/" lang="en">EN</a>
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
</div>
