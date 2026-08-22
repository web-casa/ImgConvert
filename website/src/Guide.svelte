<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Check from "@lucide/svelte/icons/check";
  import Download from "@lucide/svelte/icons/download";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { links, type Locale } from "./lib/content";
  import { guideContent, guideIds, guidePaths, type GuideId } from "./lib/guides";

  const locale: Locale = window.location.pathname.startsWith("/en") ? "en" : "zh";
  const requestedGuideId = document.querySelector('meta[name="guide-id"]')?.getAttribute("content");
  const guideId: GuideId = guideIds.includes(requestedGuideId as GuideId)
    ? (requestedGuideId as GuideId)
    : guideIds[0];
  const content = guideContent[locale];
  const guide = content.pages[guideId];
  const homeUrl = locale === "zh" ? "/" : "/en/";
  const privacyUrl = locale === "zh" ? links.privacyZh : links.privacyEn;
  const guidesUrl = `${homeUrl}#guides`;
  const docsUrl = locale === "zh" ? links.docsZh : links.docsEn;
  const blogUrl = locale === "zh" ? links.blogZh : links.blogEn;
  const alternateGuideUrl = guidePaths[locale === "zh" ? "en" : "zh"][guideId];
  const relatedGuides = guideIds
    .filter((id) => id !== guideId)
    .map((id) => ({
      page: content.pages[id],
      href: guidePaths[locale][id],
    }));
</script>

<a class="skip-link" href="#main-content">{content.common.skip}</a>

<div class="guide-shell">
  <header class="legal-topbar guide-topbar">
    <a class="brand" href={homeUrl} aria-label="ImgConvert home">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="brand-name">ImgConvert</span>
    </a>
    <nav class="legal-nav" aria-label={content.common.navigation}>
      <a href={homeUrl}>{content.common.home}</a>
      <a href={guidesUrl}>{content.common.guides}</a>
      <a href={docsUrl}>{content.common.docs}</a>
      <a href={blogUrl}>{content.common.blog}</a>
      <a href={privacyUrl}>{content.common.privacy}</a>
      <span class="language-switch" aria-label={content.common.language}>
        <a
          class:active={locale === "zh"}
          href={locale === "zh" ? guidePaths.zh[guideId] : alternateGuideUrl}
          lang="zh-CN">中</a
        >
        <span aria-hidden="true">/</span>
        <a
          class:active={locale === "en"}
          href={locale === "en" ? guidePaths.en[guideId] : alternateGuideUrl}
          lang="en">EN</a
        >
      </span>
    </nav>
  </header>

  <main id="main-content">
    <nav class="guide-breadcrumbs section-grid" aria-label="Breadcrumb">
      <a href={homeUrl}>{content.common.breadcrumbHome}</a>
      <span aria-hidden="true">/</span>
      <a href={guidesUrl}>{content.common.breadcrumbGuides}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{guide.platform}</span>
    </nav>

    <section class="guide-hero section-grid" aria-labelledby="guide-title">
      <div class="guide-hero-copy">
        <p class="eyebrow">{guide.eyebrow}</p>
        <h1 id="guide-title">{guide.title}</h1>
        <p class="guide-lede">{guide.lede}</p>
        <div class="guide-actions">
          <a
            class="button button-primary"
            href={guide.primaryCta.href}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={18} strokeWidth={2.25} aria-hidden="true" />
            {guide.primaryCta.label}
          </a>
          {#if guide.secondaryCta}
            <a
              class="button button-quiet"
              href={guide.secondaryCta.href}
              target="_blank"
              rel="noreferrer"
            >
              {guide.secondaryCta.label}<ArrowUpRight
                size={16}
                strokeWidth={2.1}
                aria-hidden="true"
              />
            </a>
          {/if}
        </div>
        <p class="guide-local-note">
          <ShieldCheck size={17} strokeWidth={2.2} aria-hidden="true" />{content.common.localNote}
        </p>
      </div>

      <aside class="guide-flow" aria-label={`${guide.input} → ${guide.output}`}>
        <p>{content.common.local}</p>
        <div class="guide-flow-formats" aria-label={`${guide.input} → ${guide.output}`}>
          <strong>{guide.input}</strong>
          <ArrowRight size={24} strokeWidth={1.9} aria-hidden="true" />
          <strong>{guide.output}</strong>
        </div>
        <dl class="guide-specs">
          <div>
            <dt>{content.common.platform}</dt>
            <dd>{guide.platform}</dd>
          </div>
          <div>
            <dt>{content.common.input}</dt>
            <dd>{guide.input}</dd>
          </div>
          <div>
            <dt>{content.common.output}</dt>
            <dd>{guide.output}</dd>
          </div>
          <div>
            <dt>{content.common.processing}</dt>
            <dd>{guide.processing}</dd>
          </div>
        </dl>
      </aside>
    </section>

    <section class="guide-workspace section-grid" aria-labelledby="workspace-title">
      <div class="guide-workspace-copy">
        <p class="eyebrow">{content.common.workspaceEyebrow}</p>
        <h2 id="workspace-title">{content.common.workspaceTitle}</h2>
        <p>{content.common.workspaceBody}</p>
      </div>
      <figure class="guide-workspace-visual">
        <picture>
          <source srcset="/images/product/format-picker.webp" type="image/webp" />
          <img
            src="/images/product/format-picker.png"
            alt={content.common.workspaceAlt}
            width="2412"
            height="1468"
            loading="lazy"
            decoding="async"
          />
        </picture>
        <figcaption>{content.common.workspaceCaption}</figcaption>
      </figure>
    </section>

    <section class="guide-instructions section-grid" aria-labelledby="steps-title">
      <div class="guide-section-heading">
        <p class="section-index"><span>01</span>{content.common.requirements}</p>
        <h2 id="steps-title">{content.common.steps}</h2>
        <ul class="guide-requirements">
          {#each guide.requirements as item (item)}
            <li><Check size={16} strokeWidth={2.5} aria-hidden="true" />{item}</li>
          {/each}
        </ul>
      </div>
      <ol class="guide-steps">
        {#each guide.steps as step, index (step.title)}
          <li>
            <span>0{index + 1}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        {/each}
      </ol>
    </section>

    <section class="guide-notes section-grid" aria-labelledby="notes-title">
      <div class="guide-notes-heading">
        <p class="section-index"><span>02</span>{content.common.notes}</p>
        <h2 id="notes-title">{content.common.local}</h2>
      </div>
      <ul class="guide-notes-list">
        {#each guide.notes as note, index (note)}
          <li>
            <span>0{index + 1}</span>
            <p>{note}</p>
          </li>
        {/each}
      </ul>
    </section>

    <section class="guide-faq section-grid" aria-labelledby="faq-title">
      <div class="guide-section-heading">
        <p class="section-index"><span>03</span>{content.common.faq}</p>
        <h2 id="faq-title">{content.common.faq}</h2>
      </div>
      <div class="faq-list guide-faq-list">
        {#each guide.questions as item, index (item.question)}
          <details open={index === 0}>
            <summary>{item.question}<span aria-hidden="true">+</span></summary>
            <p>{item.answer}</p>
          </details>
        {/each}
      </div>
    </section>

    <section class="guide-related section-grid" aria-labelledby="related-title">
      <div class="guide-related-heading">
        <p class="eyebrow">{content.common.related}</p>
        <h2 id="related-title">{content.common.related}</h2>
      </div>
      <div class="guide-related-list">
        {#each relatedGuides as related (related.href)}
          <a href={related.href}>
            <span>{related.page.platform}</span>
            <strong>{related.page.title}</strong>
            <ArrowUpRight size={18} strokeWidth={2.05} aria-hidden="true" />
          </a>
        {/each}
      </div>
      <a class="inline-link guide-all-guides" href={guidesUrl}>
        {content.common.allGuides}<ArrowRight size={16} strokeWidth={2.1} aria-hidden="true" />
      </a>
    </section>
  </main>

  <footer class="footer guide-footer">
    <div class="footer-brand">
      <a class="brand" href={homeUrl} aria-label="ImgConvert home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="brand-name">ImgConvert</span>
      </a>
      <p>{content.common.localNote}</p>
    </div>
    <div class="footer-links">
      <a href={guidesUrl}>{content.common.guides}</a>
      <a href={docsUrl}>{content.common.docs}</a>
      <a href={blogUrl}>{content.common.blog}</a>
      <a href={privacyUrl}>{content.common.privacy}</a>
      <a href={guide.primaryCta.href} target="_blank" rel="noreferrer">{content.common.download}</a>
      <a href={links.repository} target="_blank" rel="noreferrer">GitHub</a>
    </div>
  </footer>
</div>
