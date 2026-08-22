// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(scriptDirectory, "..");
const distRoot = resolve(websiteRoot, "dist");
const siteOrigin = "https://imgconvert.web.casa";
const lastModified = "2026-08-22";
const locales = ["zh", "en"];
const kinds = ["blog", "docs"];

const data = JSON.parse(await readFile(resolve(websiteRoot, "content/resources.json"), "utf8"));
const templatePath = resolve(distRoot, "resource-template/index.html");
const template = await readFile(templatePath, "utf8");

function invariant(condition, message) {
  if (!condition) throw new Error(`Invalid resource content: ${message}`);
}

function validateResources() {
  const referenceIds = Object.keys(data.zh?.pages ?? {}).sort();
  invariant(referenceIds.length > 0, "the Chinese page collection is empty");

  for (const locale of locales) {
    const localeData = data[locale];
    invariant(localeData, `missing ${locale} locale`);
    invariant(localeData.common, `missing ${locale} common labels`);
    invariant(localeData.hubs, `missing ${locale} hubs`);

    const ids = Object.keys(localeData.pages ?? {}).sort();
    invariant(
      JSON.stringify(ids) === JSON.stringify(referenceIds),
      `${locale} page ids do not match zh`,
    );

    for (const kind of kinds) {
      const hub = localeData.hubs[kind];
      invariant(hub?.kind === kind, `missing or invalid ${locale} ${kind} hub`);
      invariant(
        hub.title && hub.description && hub.keywords?.length,
        `${locale} ${kind} hub metadata is incomplete`,
      );
    }

    for (const [id, page] of Object.entries(localeData.pages)) {
      invariant(
        page.kind === "blog" || page.kind === "docs",
        `${locale}:${id} has an unknown kind`,
      );
      invariant(
        page.slug && page.title && page.description,
        `${locale}:${id} metadata is incomplete`,
      );
      invariant(page.keywords?.length, `${locale}:${id} has no keywords`);
      invariant(page.sections?.length, `${locale}:${id} has no body sections`);
      invariant(page.questions?.length, `${locale}:${id} has no FAQ entries`);

      for (const relatedId of page.related ?? []) {
        invariant(
          localeData.pages[relatedId],
          `${locale}:${id} links to unknown resource ${relatedId}`,
        );
      }
    }
  }
}

validateResources();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function hubPath(locale, kind) {
  return locale === "zh" ? `/${kind}/` : `/en/${kind}/`;
}

function pagePath(locale, page) {
  return locale === "zh" ? `/${page.kind}/${page.slug}/` : `/en/${page.kind}/${page.slug}/`;
}

function absolute(pathname) {
  return `${siteOrigin}${pathname}`;
}

function plainTitle(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function pageVisual(locale, page) {
  const common = data[locale].common;

  if (page.visual === "format-picker") {
    return {
      src: "/images/product/format-picker.png",
      alt: common.formatVisualAlt,
      caption: common.formatVisualCaption,
    };
  }

  if (page.visual === "live-workspace") {
    return {
      src: "/images/product/live-workspace.png",
      alt: common.workspaceVisualAlt,
      caption: common.workspaceVisualCaption,
    };
  }

  if (page.visual === "privacy-editorial") {
    return {
      src: "/images/generated/local-atelier.png",
      alt: common.privacyVisualAlt,
      caption: common.privacyVisualCaption,
    };
  }

  return undefined;
}

function metaTags({
  locale,
  ogType,
  title,
  description,
  keywords,
  canonicalPath,
  alternatePath,
  graph,
}) {
  const ogLocale = locale === "zh" ? "zh_CN" : "en_US";
  const alternateLocale = locale === "zh" ? "en_US" : "zh_CN";
  const socialImage = `${siteOrigin}/images/product/main-workspace.png`;
  const url = absolute(canonicalPath);

  return [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="keywords" content="${escapeHtml(keywords.join(", "))}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" hreflang="zh-CN" href="${absolute(locale === "zh" ? canonicalPath : alternatePath)}" />`,
    `<link rel="alternate" hreflang="en" href="${absolute(locale === "en" ? canonicalPath : alternatePath)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${absolute(locale === "zh" ? canonicalPath : alternatePath)}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:locale" content="${ogLocale}" />`,
    `<meta property="og:locale:alternate" content="${alternateLocale}" />`,
    `<meta property="og:site_name" content="ImgConvert" />`,
    `<meta property="og:title" content="${escapeHtml(title)} | ImgConvert" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${socialImage}" />`,
    `<meta property="og:image:alt" content="ImgConvert local image conversion workspace" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)} | ImgConvert" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${socialImage}" />`,
    `<script type="application/ld+json">${escapeJson(graph)}</script>`,
    `<title>${escapeHtml(title)} | ImgConvert</title>`,
  ].join("\n    ");
}

function breadcrumbs(locale, kind, label, currentPath) {
  const common = data[locale].common;
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: common.home,
        item: absolute(locale === "zh" ? "/" : "/en/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: kind === "blog" ? common.blog : common.docs,
        item: absolute(hubPath(locale, kind)),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: label,
        item: absolute(currentPath),
      },
    ],
  };
}

function renderArticleFallback(locale, page) {
  const common = data[locale].common;
  const related = page.related
    .map((id) => data[locale].pages[id])
    .filter(Boolean)
    .map((item) => `<li><a href="${pagePath(locale, item)}">${escapeHtml(item.title)}</a></li>`)
    .join("");
  const visual = pageVisual(locale, page);
  const visualMarkup = visual
    ? `<figure><img src="${visual.src}" alt="${escapeHtml(visual.alt)}" loading="lazy" /><figcaption>${escapeHtml(visual.caption)}</figcaption></figure>`
    : "";
  const sections = page.sections
    .map((section) => {
      const paragraphs = section.paragraphs
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("");
      const list = section.list
        ? `<ul>${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : "";
      return `<section><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${list}</section>`;
    })
    .join("");
  const questions = page.questions
    .map(
      (question) =>
        `<section><h3>${escapeHtml(question.question)}</h3><p>${escapeHtml(question.answer)}</p></section>`,
    )
    .join("");

  return `<main class="seo-fallback"><p>${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.lede)}</p>${visualMarkup}<h2>${escapeHtml(common.takeaways)}</h2><ul>${page.takeaways.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>${sections}<aside><h2>${escapeHtml(page.callout.title)}</h2><p>${escapeHtml(page.callout.body)}</p></aside><h2>${escapeHtml(common.faq)}</h2>${questions}<h2>${escapeHtml(common.related)}</h2><ul>${related}</ul><p><a href="${hubPath(locale, page.kind)}">${escapeHtml(page.kind === "blog" ? common.blog : common.docs)}</a> · <a href="${locale === "zh" ? "/#download" : "/en/#download"}">${escapeHtml(common.download)}</a></p></main>`;
}

function renderHubFallback(locale, kind) {
  const common = data[locale].common;
  const hub = data[locale].hubs[kind];
  const pages = Object.values(data[locale].pages).filter((page) => page.kind === kind);
  const items = pages
    .map(
      (page) =>
        `<article><p>${escapeHtml(page.label)} · ${escapeHtml(page.readingTime)}</p><h2><a href="${pagePath(locale, page)}">${escapeHtml(page.title)}</a></h2><p>${escapeHtml(page.lede)}</p></article>`,
    )
    .join("");

  return `<main class="seo-fallback"><p>${escapeHtml(hub.eyebrow)}</p><h1>${escapeHtml(hub.title)}</h1><p>${escapeHtml(hub.lede)}</p><h2>${escapeHtml(hub.indexTitle)}</h2>${items}<p><a href="${kind === "blog" ? hubPath(locale, "docs") : hubPath(locale, "blog")}">${escapeHtml(kind === "blog" ? common.docs : common.blog)}</a> · <a href="${locale === "zh" ? "/" : "/en/"}">${escapeHtml(common.home)}</a></p></main>`;
}

function createTemplate({ locale, pageKind, resourceId, meta, fallback }) {
  return template
    .replaceAll("__RESOURCE_LANG__", locale === "zh" ? "zh-CN" : "en")
    .replaceAll("resource-template", pageKind)
    .replaceAll("__RESOURCE_ID__", resourceId)
    .replaceAll(
      "__RESOURCE_ROBOTS__",
      "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
    )
    .replaceAll("__RESOURCE_META__", meta)
    .replaceAll("__RESOURCE_FALLBACK__", fallback);
}

async function writePage(pathname, html) {
  const output = resolve(distRoot, `.${pathname}`, "index.html");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
}

const resourceUrls = [];

for (const locale of locales) {
  const localeData = data[locale];

  for (const kind of kinds) {
    const hub = localeData.hubs[kind];
    const path = hubPath(locale, kind);
    const alternatePath = hubPath(locale === "zh" ? "en" : "zh", kind);
    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CollectionPage",
          name: hub.title,
          description: hub.description,
          url: absolute(path),
          inLanguage: locale === "zh" ? "zh-CN" : "en",
          isPartOf: {
            "@type": "WebSite",
            name: "ImgConvert",
            url: siteOrigin,
          },
        },
        breadcrumbs(locale, kind, localeData.common[kind], path),
      ],
    };
    const html = createTemplate({
      locale,
      pageKind: "resource-hub",
      resourceId: kind,
      meta: metaTags({
        locale,
        ogType: "website",
        title: plainTitle(hub.title),
        description: hub.description,
        keywords: hub.keywords,
        canonicalPath: path,
        alternatePath,
        graph,
      }),
      fallback: renderHubFallback(locale, kind),
    });

    await writePage(path, html);
    resourceUrls.push({ locale, path, alternatePath });
  }

  for (const page of Object.values(localeData.pages)) {
    const path = pagePath(locale, page);
    const alternatePage = data[locale === "zh" ? "en" : "zh"].pages[page.id];
    if (!alternatePage) throw new Error(`Missing alternate resource for ${locale}:${page.id}`);
    const alternatePath = pagePath(locale === "zh" ? "en" : "zh", alternatePage);
    const articleType = page.kind === "blog" ? "Article" : "TechArticle";
    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": articleType,
          headline: plainTitle(page.title),
          description: page.description,
          url: absolute(path),
          mainEntityOfPage: absolute(path),
          inLanguage: locale === "zh" ? "zh-CN" : "en",
          datePublished: lastModified,
          dateModified: lastModified,
          publisher: {
            "@type": "Organization",
            name: "ImgConvert",
            url: siteOrigin,
          },
        },
        breadcrumbs(locale, page.kind, page.label, path),
        {
          "@type": "FAQPage",
          mainEntity: page.questions.map((question) => ({
            "@type": "Question",
            name: question.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: question.answer,
            },
          })),
        },
      ],
    };
    const html = createTemplate({
      locale,
      pageKind: "resource",
      resourceId: page.id,
      meta: metaTags({
        locale,
        ogType: "article",
        title: plainTitle(page.title),
        description: page.description,
        keywords: page.keywords,
        canonicalPath: path,
        alternatePath,
        graph,
      }),
      fallback: renderArticleFallback(locale, page),
    });

    await writePage(path, html);
    resourceUrls.push({ locale, path, alternatePath });
  }
}

const sitemapPath = resolve(distRoot, "sitemap.xml");
const sitemap = await readFile(sitemapPath, "utf8");
const sitemapEntries = resourceUrls
  .map(
    ({ locale, path, alternatePath }) =>
      `  <url>\n    <loc>${absolute(path)}</loc>\n    <lastmod>${lastModified}</lastmod>\n    <xhtml:link rel="alternate" hreflang="zh-CN" href="${absolute(locale === "zh" ? path : alternatePath)}" />\n    <xhtml:link rel="alternate" hreflang="en" href="${absolute(locale === "en" ? path : alternatePath)}" />\n  </url>`,
  )
  .join("\n");

if (!sitemap.includes("<!-- RESOURCE_URLS -->")) {
  throw new Error("sitemap.xml is missing the RESOURCE_URLS marker");
}

await writeFile(sitemapPath, sitemap.replace("<!-- RESOURCE_URLS -->", sitemapEntries));

const noindexTemplate = template
  .replaceAll("__RESOURCE_LANG__", "en")
  .replaceAll("resource-template", "resource-template")
  .replaceAll("__RESOURCE_ID__", "template")
  .replaceAll("__RESOURCE_ROBOTS__", "noindex,nofollow")
  .replaceAll("__RESOURCE_META__", "<title>ImgConvert resource template</title>")
  .replaceAll(
    "__RESOURCE_FALLBACK__",
    '<main class="seo-fallback"><h1>Resource template</h1></main>',
  );
await writeFile(templatePath, noindexTemplate);
