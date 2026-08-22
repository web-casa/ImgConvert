<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import FileText from "@lucide/svelte/icons/file-text";
  import { links, type Locale } from "./lib/content";
  import {
    hubPath,
    resourcePages,
    resourcePath,
    resources,
    type ResourceKind,
  } from "./lib/resources";

  const locale: Locale = window.location.pathname.startsWith("/en") ? "en" : "zh";
  const requestedKind = document.querySelector('meta[name="resource-id"]')?.getAttribute("content");
  const kind: ResourceKind = requestedKind === "docs" ? "docs" : "blog";
  const content = resources[locale];
  const hub = content.hubs[kind];
  const pages = resourcePages(locale, kind);
  const homeUrl = locale === "zh" ? "/" : "/en/";
  const guidesUrl = `${homeUrl}#guides`;
  const privacyUrl = locale === "zh" ? links.privacyZh : links.privacyEn;
  const alternateHubUrl = hubPath(locale === "zh" ? "en" : "zh", kind);
</script>

<a class="skip-link" href="#main-content">{content.common.skip}</a>

<div class="resource-shell">
  <header class="legal-topbar resource-topbar">
    <a class="brand" href={homeUrl} aria-label="ImgConvert home">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="brand-name">ImgConvert</span>
    </a>
    <nav class="legal-nav" aria-label={content.common.navigation}>
      <a href={homeUrl}>{content.common.home}</a>
      <a class:active={kind === "docs"} href={hubPath(locale, "docs")}>{content.common.docs}</a>
      <a class:active={kind === "blog"} href={hubPath(locale, "blog")}>{content.common.blog}</a>
      <a href={guidesUrl}>{content.common.guides}</a>
      <a href={privacyUrl}>{content.common.privacy}</a>
      <span class="language-switch" aria-label={content.common.language}>
        <a
          class:active={locale === "zh"}
          href={locale === "zh" ? hubPath(locale, kind) : alternateHubUrl}
          lang="zh-CN">中</a
        >
        <span aria-hidden="true">/</span>
        <a
          class:active={locale === "en"}
          href={locale === "en" ? hubPath(locale, kind) : alternateHubUrl}
          lang="en">EN</a
        >
      </span>
    </nav>
  </header>

  <main id="main-content">
    <section class="resource-hub-hero section-grid" aria-labelledby="resource-hub-title">
      <div>
        <p class="eyebrow">{hub.eyebrow}</p>
        <h1 id="resource-hub-title">{hub.title}</h1>
        <p>{hub.lede}</p>
      </div>
      <aside class="resource-hub-signal" aria-label={hub.indexTitle}>
        {#if kind === "blog"}
          <BookOpen size={22} strokeWidth={1.9} aria-hidden="true" />
        {:else}
          <FileText size={22} strokeWidth={1.9} aria-hidden="true" />
        {/if}
        <span>{String(pages.length).padStart(2, "0")}</span>
        <p>{hub.indexBody}</p>
      </aside>
    </section>

    <section class="resource-index section-grid" aria-labelledby="resource-index-title">
      <div class="resource-index-heading">
        <p class="section-index"><span>01</span>{hub.eyebrow}</p>
        <h2 id="resource-index-title">{hub.indexTitle}</h2>
      </div>
      <div class="resource-index-list">
        {#each pages as page, index (page.id)}
          <a class="resource-row" href={resourcePath(locale, page.id)}>
            <span class="resource-row-no">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p>{page.label} <span aria-hidden="true">·</span> {page.readingTime}</p>
              <h3>{page.title}</h3>
              <span class="resource-row-lede">{page.lede}</span>
            </div>
            <span class="resource-row-action">
              {kind === "blog" ? content.common.read : content.common.open}<ArrowRight
                size={17}
                strokeWidth={2.1}
                aria-hidden="true"
              />
            </span>
          </a>
        {/each}
      </div>
    </section>

    <section class="resource-hub-crosslink section-grid" aria-label={content.common.localNote}>
      <p>{content.common.localNote}</p>
      <a href={kind === "blog" ? hubPath(locale, "docs") : hubPath(locale, "blog")}>
        {kind === "blog" ? content.common.docs : content.common.blog}<ArrowUpRight
          size={16}
          strokeWidth={2.1}
          aria-hidden="true"
        />
      </a>
    </section>
  </main>

  <footer class="footer resource-footer">
    <div class="footer-brand">
      <a class="brand" href={homeUrl} aria-label="ImgConvert home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="brand-name">ImgConvert</span>
      </a>
      <p>{content.common.localNote}</p>
    </div>
    <div class="footer-links">
      <a href={hubPath(locale, "docs")}>{content.common.docs}</a>
      <a href={hubPath(locale, "blog")}>{content.common.blog}</a>
      <a href={guidesUrl}>{content.common.guides}</a>
      <a href={privacyUrl}>{content.common.privacy}</a>
      <a href={links.repository} target="_blank" rel="noreferrer">GitHub</a>
    </div>
  </footer>
</div>
