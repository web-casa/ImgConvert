<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Check from "@lucide/svelte/icons/check";
  import Download from "@lucide/svelte/icons/download";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { links, type Locale } from "./lib/content";
  import {
    hubPath,
    resourcePages,
    resourcePath,
    resources,
    type ResourcePage as ResourcePageType,
  } from "./lib/resources";

  type VisualAsset = {
    avif?: string;
    webp: string;
    png: string;
    width: number;
    height: number;
    alt: string;
    caption: string;
  };

  const locale: Locale = window.location.pathname.startsWith("/en") ? "en" : "zh";
  const requestedId =
    document.querySelector('meta[name="resource-id"]')?.getAttribute("content") ?? "";
  const content = resources[locale];
  const fallbackPage = resourcePages(locale, "blog")[0];
  if (!fallbackPage) {
    throw new Error("A fallback resource page is required.");
  }
  const page: ResourcePageType = content.pages[requestedId] ?? fallbackPage;
  const homeUrl = locale === "zh" ? "/" : "/en/";
  const guidesUrl = `${homeUrl}#guides`;
  const privacyUrl = locale === "zh" ? links.privacyZh : links.privacyEn;
  const alternatePageUrl = resourcePath(locale === "zh" ? "en" : "zh", page.id);
  const related = page.related
    .map((id) => content.pages[id])
    .filter((candidate): candidate is ResourcePageType => Boolean(candidate));

  const visual: VisualAsset | undefined = page.visual
    ? {
        "format-picker": {
          webp: "/images/product/format-picker.webp",
          png: "/images/product/format-picker.png",
          width: 2412,
          height: 1468,
          alt: content.common.formatVisualAlt,
          caption: content.common.formatVisualCaption,
        },
        "live-workspace": {
          avif: "/images/product/live-workspace.avif",
          webp: "/images/product/live-workspace.webp",
          png: "/images/product/live-workspace.png",
          width: 900,
          height: 680,
          alt: content.common.workspaceVisualAlt,
          caption: content.common.workspaceVisualCaption,
        },
        "privacy-editorial": {
          avif: "/images/generated/local-atelier.avif",
          webp: "/images/generated/local-atelier.webp",
          png: "/images/generated/local-atelier.png",
          width: 1122,
          height: 1402,
          alt: content.common.privacyVisualAlt,
          caption: content.common.privacyVisualCaption,
        },
      }[page.visual]
    : undefined;
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
      <a class:active={page.kind === "docs"} href={hubPath(locale, "docs")}>{content.common.docs}</a
      >
      <a class:active={page.kind === "blog"} href={hubPath(locale, "blog")}>{content.common.blog}</a
      >
      <a href={guidesUrl}>{content.common.guides}</a>
      <a href={privacyUrl}>{content.common.privacy}</a>
      <span class="language-switch" aria-label={content.common.language}>
        <a
          class:active={locale === "zh"}
          href={locale === "zh" ? resourcePath(locale, page.id) : alternatePageUrl}
          lang="zh-CN">中</a
        >
        <span aria-hidden="true">/</span>
        <a
          class:active={locale === "en"}
          href={locale === "en" ? resourcePath(locale, page.id) : alternatePageUrl}
          lang="en">EN</a
        >
      </span>
    </nav>
  </header>

  <main id="main-content">
    <nav class="resource-breadcrumbs section-grid" aria-label="Breadcrumb">
      <a href={homeUrl}>{content.common.breadcrumbHome}</a>
      <span aria-hidden="true">/</span>
      <a href={hubPath(locale, page.kind)}
        >{page.kind === "blog" ? content.common.blog : content.common.docs}</a
      >
      <span aria-hidden="true">/</span>
      <span aria-current="page">{page.label}</span>
    </nav>

    <article>
      <header class="resource-article-hero section-grid">
        <div class="resource-article-copy">
          <p class="eyebrow">{page.eyebrow}</p>
          <p class="resource-article-meta">
            {page.label} <span aria-hidden="true">·</span>
            {page.readingTime}
          </p>
          <h1>{page.title}</h1>
          <p class="resource-article-lede">{page.lede}</p>
          <p class="resource-local-note">
            <ShieldCheck size={17} strokeWidth={2.2} aria-hidden="true" />{content.common.localNote}
          </p>
        </div>
        <aside class="resource-takeaways" aria-label={content.common.takeaways}>
          <p>{content.common.takeaways}</p>
          <ol>
            {#each page.takeaways as takeaway, index (takeaway)}
              <li><span>{String(index + 1).padStart(2, "0")}</span>{takeaway}</li>
            {/each}
          </ol>
        </aside>
      </header>

      {#if visual}
        <figure
          class:resource-article-visual-tall={page.visual === "privacy-editorial"}
          class="resource-article-visual section-grid"
        >
          <picture>
            {#if visual.avif}<source srcset={visual.avif} type="image/avif" />{/if}
            <source srcset={visual.webp} type="image/webp" />
            <img
              src={visual.png}
              alt={visual.alt}
              width={visual.width}
              height={visual.height}
              loading="lazy"
              decoding="async"
            />
          </picture>
          <figcaption>{visual.caption}</figcaption>
        </figure>
      {/if}

      <section class="resource-article-body section-grid">
        <aside class="resource-article-rail" aria-hidden="true">
          <span>{page.kind === "blog" ? content.common.blog : content.common.docs}</span>
          <span>{page.readingTime}</span>
        </aside>
        <div class="resource-prose">
          {#each page.sections as section, index (section.heading)}
            <section aria-labelledby={`section-${index}`}>
              <p class="section-index">
                <span>{String(index + 1).padStart(2, "0")}</span>{page.label}
              </p>
              <h2 id={`section-${index}`}>{section.heading}</h2>
              {#each section.paragraphs as paragraph (paragraph)}
                <p>{paragraph}</p>
              {/each}
              {#if section.list}
                <ul>
                  {#each section.list as item (item)}
                    <li><Check size={17} strokeWidth={2.5} aria-hidden="true" />{item}</li>
                  {/each}
                </ul>
              {/if}
            </section>
          {/each}

          <aside class="resource-callout">
            <p>{page.callout.title}</p>
            <span>{page.callout.body}</span>
          </aside>

          <section class="resource-faq" aria-labelledby="resource-faq-title">
            <p class="section-index"><span>04</span>{content.common.faq}</p>
            <h2 id="resource-faq-title">{content.common.faq}</h2>
            <div class="faq-list">
              {#each page.questions as item, index (item.question)}
                <details open={index === 0}>
                  <summary>{item.question}<span aria-hidden="true">+</span></summary>
                  <p>{item.answer}</p>
                </details>
              {/each}
            </div>
          </section>

          <a class="button button-primary resource-download" href={`${homeUrl}#download`}>
            <Download size={18} strokeWidth={2.25} aria-hidden="true" />{content.common.download}
          </a>
        </div>
      </section>
    </article>

    {#if related.length}
      <section class="resource-related section-grid" aria-labelledby="resource-related-title">
        <div>
          <p class="eyebrow">{content.common.related}</p>
          <h2 id="resource-related-title">{content.common.related}</h2>
        </div>
        <div class="resource-related-list">
          {#each related as item (item.id)}
            <a href={resourcePath(locale, item.id)}>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <ArrowUpRight size={18} strokeWidth={2.05} aria-hidden="true" />
            </a>
          {/each}
        </div>
      </section>
    {/if}

    <a class="resource-back section-grid" href={hubPath(locale, page.kind)}>
      <ArrowRight size={17} strokeWidth={2.1} aria-hidden="true" />{page.kind === "blog"
        ? content.common.blog
        : content.common.docs}
    </a>
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
