# ImgConvert website

The product landing site is an isolated Svelte/Vite workspace package. It deliberately does not
reuse the Tauri application's Vite configuration.

## Local development

```bash
pnpm website:dev
pnpm website:check
```

The Chinese site is served at `/`; the English site is a separate static entry at `/en/`. Privacy
and legal information have equivalent static entries at `/privacy/`, `/legal/`, `/en/privacy/`, and
`/en/legal/`. Platform-and-format guides have Chinese and English entries under
`/windows/png-to-avif/`, `/windows/batch-image-compression/`, `/macos/heic-to-jpg/`,
`/macos/png-to-webp/`, `/ubuntu/webp-lossless-compression/`, `/linux/jpeg-to-avif/`, and their
matching `/en/…/` paths.

`/blog/` and `/docs/` have matching `/en/blog/` and `/en/docs/` hubs. Their initial article and
documentation pages are defined in [`content/resources.json`](./content/resources.json). The build
generates the final static routes, page-specific metadata, JSON-LD, semantic fallback HTML, and the
resource entries in `sitemap.xml`; do not hand-edit generated files in `dist/`.

## Cloudflare Pages

Create a Git-connected Pages project against this repository with these settings:

| Setting                | Value                      |
| ---------------------- | -------------------------- |
| Production branch      | `main`                     |
| Root directory         | repository root            |
| Build command          | `pnpm --dir website build` |
| Build output directory | `website/dist`             |
| Node.js version        | `22.22.2`                  |

After a preview deployment passes, add `imgconvert.web.casa` through **Pages → Custom domains**.
The output contains `_headers`, `robots.txt`, `sitemap.xml`, a web manifest, and both language
entries. `_headers` is applied by Cloudflare Pages to static responses.

## Product visual

The landing page uses real product screenshots from
`website/public/images/product/` for its primary interface evidence, including a fresh isolated
runtime capture and the output-format picker. They prefer AVIF/WebP in supporting browsers with
PNG fallbacks. The generated privacy editorial in `website/public/images/generated/` is intentionally
separate from product claims and also uses AVIF/WebP with a PNG fallback.

## SEO notes

The keyword map, page-level strategy, and post-launch measurement loop are documented in
[`SEO.md`](./SEO.md). Keep product claims, format support, and privacy statements aligned with the
application and the repository policies when adding new search pages.
