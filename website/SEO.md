# ImgConvert SEO strategy

## Positioning

The site should earn relevant traffic for a local desktop image workflow, not compete for generic “image converter” queries with vague claims. Every page should stay consistent with the product and privacy policy: conversion happens locally, original images are not uploaded, and HEIC is read-only import rather than an output format.

## Keyword map

| Intent                    | Chinese phrases                            | English phrases                                                            | Best destination                             |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------- |
| Core product              | 本地图片转换、图片格式转换、图片批量转换   | local image converter, image format converter, batch image conversion      | Home                                         |
| Compression               | 图片压缩、批量图片压缩、离线图片压缩       | image compression, batch image compression, offline image compression      | Home, Windows batch guide, Ubuntu WebP guide |
| Output formats            | AVIF 转换、WebP 转换、JPEG 转换、PNG 转换  | AVIF converter, WebP converter, JPEG converter, PNG converter              | Home and a matching guide                    |
| Privacy intent            | 图片不上传、本地处理图片、离线图片转换     | no-upload image converter, local image processing, offline image converter | Home, guides, and privacy policy             |
| Windows AVIF task         | Windows PNG 转 AVIF、PNG 转 AVIF 本地工具  | Windows PNG to AVIF converter, local PNG to AVIF                           | `/windows/png-to-avif/`                      |
| macOS HEIC task           | macOS HEIC 转 JPG、Mac HEIC 转 JPEG        | macOS HEIC to JPG converter, local HEIC to JPEG                            | `/macos/heic-to-jpg/`                        |
| Ubuntu lossless WebP task | Ubuntu WebP 无损压缩、Linux WebP 本地压缩  | Ubuntu lossless WebP compression, local WebP compression                   | `/ubuntu/webp-lossless-compression/`         |
| Windows batch task        | Windows 批量图片压缩、Windows 图片压缩软件 | Windows batch image compression, batch image compressor Windows            | `/windows/batch-image-compression/`          |
| macOS WebP task           | macOS PNG 转 WebP、Mac PNG 转 WebP         | macOS PNG to WebP, local PNG to WebP                                       | `/macos/png-to-webp/`                        |
| Linux AVIF task           | Linux JPEG 转 AVIF、Linux JPG 转 AVIF      | Linux JPEG to AVIF, local JPEG to AVIF                                     | `/linux/jpeg-to-avif/`                       |
| Format decision           | AVIF、WebP、PNG 怎么选、WebP 和 PNG 区别   | AVIF vs WebP vs PNG, WebP vs PNG                                           | `/blog/avif-vs-webp-vs-png/`                 |
| Local vs online decision  | 本地图片转换、在线图片转换对比、图片不上传 | local vs online image converter, no-upload image converter                 | `/blog/local-vs-online-image-converter/`     |
| Compression concepts      | 图片压缩质量和无损区别、无损图片压缩       | image compression quality vs lossless, lossless image compression          | `/blog/compression-quality-vs-lossless/`     |
| Product boundaries        | 图片格式支持、HEIC 导入、批量转换工作流    | image format support, HEIC import, batch conversion workflow               | `/docs/` and matching doc page               |

Do not create pages merely to repeat these phrases. A query gets its own page only when the page contains product-specific instructions, screenshots, download guidance, and a truthful feature explanation.

## Already implemented

- Unique Chinese and English titles and descriptions, with descriptive product terms rather than repeated keyword lists.
- One clear H1 per page; natural references to local conversion, batch processing, compression, formats, and privacy in visible copy.
- Bilingual canonical URLs, reciprocal `hreflang` links, and a sitemap that contains all indexable site pages.
- Crawlable internal links to Privacy and Open source & legal pages; a custom `404.html` that is `noindex`.
- Six task-led guide pairs: Windows PNG → AVIF, Windows batch image compression, macOS HEIC/HEIF → JPEG, macOS PNG → WebP, Ubuntu WebP lossless re-encoding, and Linux JPEG → AVIF. Each guide states a platform-specific boundary instead of promising generic compatibility.
- Bilingual Blog and Documentation hubs with three decision-led articles (AVIF/WebP/PNG, local vs online conversion, and quality vs lossless) and four verified product references (supported formats, batch workflow, local processing/privacy, and quality/lossless behavior).
- Each resource page has a unique title, description, canonical URL, reciprocal language alternate, `Article` or `TechArticle` + `BreadcrumbList` + visible FAQ schema, semantic static fallback, internal related reading, and a relevant in-product download route.
- `WebSite`, `SoftwareApplication`, `WebPage`, `BreadcrumbList`, `HowTo`, and FAQ JSON-LD where the visible page supports that type.
- Open Graph and Twitter metadata, product-image alt text, and a semantic no-JavaScript fallback on the home, guide, privacy, and legal entries.
- Each guide fallback has the same title, core steps, caveat, and download path as its rendered page.
- The home and guides use real product-interface screenshots as proof, while the privacy illustration is clearly editorial. The primary and editorial images now prefer AVIF/WebP with PNG fallbacks, so the visual system does not add an avoidable payload.
- The primary download CTA detects Windows, macOS, and Linux in the browser: Windows visitors go directly to Microsoft Store; macOS and Linux visitors go to the current GitHub release; unknown platforms are sent to the platform chooser. Every route still exposes all three choices.

`meta keywords` is retained as a compact catalog for legacy crawlers, but it is not the ranking strategy. The visible page title, heading, body copy, internal links, useful feature pages, and external references matter more.

## Content roadmap

1. Add one useful, maintained page at a time for a query that has a verified, product-specific answer. Each new page needs exact feature boundaries, relevant FAQ, a direct download path, and a corresponding entry in `content/resources.json` so the static route and sitemap are generated together.
2. Publish release notes or a changelog for meaningful releases. These pages create truthful long-tail entry points and give external links a stable destination.
3. Keep the GitHub repository, app-store listings, release notes, and this site cross-linked with consistent product name, homepage URL, and privacy-policy URL.
4. Add a dedicated 1200 × 630 social image after the visual system is locked. It should use the real product interface and a short local-first promise, not a generic stock illustration.
5. Maintain the six guides when product behavior changes. Retire or redirect a guide if its specific capability is removed; do not preserve search traffic with a misleading page.

## Measurement loop after launch

1. Verify the domain in Google Search Console and Bing Webmaster Tools; submit `https://imgconvert.web.casa/sitemap.xml`.
2. Inspect coverage, canonical selection, mobile usability, and Core Web Vitals before adding more pages.
3. Review search queries and click-through rate monthly. Improve a page’s title and on-page explanation only when actual query data shows a mismatch.
4. Validate structured data after each content change. Structured data describes content; it is not a substitute for useful content or a guarantee of a rich result.

## Search-property checklist

- The production sitemap is ready at `https://imgconvert.web.casa/sitemap.xml`, and the site already exposes `robots.txt`, canonical URLs, and bilingual alternates.
- Domain ownership in Google Search Console and Bing Webmaster Tools still needs the site owner's account or verification token. Once verified, submit the sitemap, request inspection for the home page and each new guide pair, then review query impressions and click-through rate after enough data has accumulated.
- Keep the site analytics-free unless a privacy-policy update and a deliberate measurement decision are approved. Search Console and Bing Webmaster Tools provide the initial search-performance data without adding a client-side tracking script.

## Technical implementation

The guide, privacy, legal, Blog, and Docs entries provide static URLs, unique metadata, and semantic initial HTML before their Svelte pages mount. Blog and Docs source lives in `content/resources.json`; `scripts/generate-resource-pages.mjs` turns it into static pages, page-specific schema, and sitemap entries after the Vite build. Keep the source, visible content, and structured data aligned—do not make the schema claim a capability the rendered article does not explain.
