<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Check from "@lucide/svelte/icons/check";
  import { links, type Locale } from "./lib/content";
  import { legalContent } from "./lib/legal";

  const locale: Locale = window.location.pathname.startsWith("/en") ? "en" : "zh";
  const copy = legalContent[locale];
  const homeUrl = locale === "zh" ? "/" : "/en/";
  const privacyUrl = locale === "zh" ? "/privacy/" : "/en/privacy/";
  const legalUrl = locale === "zh" ? links.legalZh : links.legalEn;
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
      <a class="active" href={privacyUrl}>{copy.common.privacy}</a>
      <a href={legalUrl}>{copy.common.legal}</a>
      <span class="language-switch" aria-label={copy.common.language}>
        <a class:active={locale === "zh"} href="/privacy/" lang="zh-CN">中</a>
        <span aria-hidden="true">/</span>
        <a class:active={locale === "en"} href="/en/privacy/" lang="en">EN</a>
      </span>
    </nav>
  </header>

  <main class="legal-main" id="main-content">
    <section class="legal-hero section-grid">
      <div>
        <p class="eyebrow">{copy.privacy.eyebrow}</p>
        <h1>{copy.privacy.title}</h1>
        <p>{copy.privacy.intro}</p>
      </div>
      <div class="policy-summary">
        <p>{copy.privacy.effectiveDate}</p>
        <p>{copy.privacy.sourceNote}</p>
      </div>
    </section>

    <article class="policy-article section-grid">
      {#each copy.privacy.sections as section (section.title)}
        <section>
          <h2>{section.title}</h2>
          {#if section.intro}<p>{section.intro}</p>{/if}
          {#if section.paragraphs}
            {#each section.paragraphs as paragraph (paragraph)}
              <p>{paragraph}</p>
            {/each}
          {/if}
          {#if section.items}
            <ul>
              {#each section.items as item (item)}
                <li><Check size={17} strokeWidth={2.3} aria-hidden="true" />{item}</li>
              {/each}
            </ul>
          {/if}
          {#if section.outro}<p>{section.outro}</p>{/if}
        </section>
      {/each}

      <section class="policy-contact">
        <h2>{copy.privacy.contactTitle}</h2>
        <p>{copy.privacy.contact}</p>
        <a class="inline-link dark-link" href={links.issues} target="_blank" rel="noreferrer">
          {copy.privacy.contactLink}<ArrowUpRight size={16} strokeWidth={2.1} aria-hidden="true" />
        </a>
      </section>
    </article>

    <a class="legal-return section-grid" href={homeUrl}>
      <ArrowLeft size={17} strokeWidth={2.1} aria-hidden="true" />{copy.common.home}
    </a>
  </main>
</div>
