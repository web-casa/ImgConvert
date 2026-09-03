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

| Setting                | Value                        |
| ---------------------- | ---------------------------- |
| Production branch      | `main`                       |
| Root directory         | repository root              |
| Build command          | `pnpm run web:release:build` |
| Build output directory | `website/dist`               |
| Node.js version        | `22.22.2`                    |

The release command builds the marketing site and Web app independently, safely assembles
`web-app/dist` into `website/dist/convert`, and checks routes, resource scope, lazy engine loading,
PWA boundaries, CSP, and cache rules. Do not point the Web app's Vite `outDir` at `website/dist`.

Every non-production branch should first produce a Cloudflare Pages preview. Validate its real
MIME types and response headers before promoting the same commit:

```bash
pnpm run web:release:build
pnpm run web:release:preview:smoke -- --url=https://BRANCH.PROJECT.pages.dev
IMGCONVERT_WEB_PREVIEW_ORIGIN=https://BRANCH.PROJECT.pages.dev pnpm --dir web-app test:e2e
IMGCONVERT_WEB_PREVIEW_ORIGIN=https://BRANCH.PROJECT.pages.dev pnpm --dir web-app test:e2e:mobile
```

The smoke command accepts only an HTTPS `*.pages.dev` origin and is read-only. It verifies the
marketing routes plus `/convert/`, all converter JS/worker/WASM MIME types, the manifest, service
worker scope, CSP, `nosniff`, and cache headers. The remote E2E command applies the same origin
restriction, disables the local Vite server, and exercises conversion, download, PWA, cancellation,
privacy, keyboard, and responsive flows against the deployed Preview in Chromium, Firefox, and
WebKit. Remote projects run through one Playwright worker so cold AVIF WASM encoders do not compete
for host memory; local runs retain normal parallel workers. A local Vite preview is useful for
visual checks but does not apply Cloudflare Pages `_headers`, so it cannot replace these
deployed-preview gates.

The dedicated mobile preflight runs Pixel 7/Chromium and iPhone 13/WebKit emulation serially. It
checks that an imported file produces an immediately visible queue receipt, completes a real local
conversion and download, stays within the viewport, and sends no content cross-origin. Emulation is
not a substitute for the physical-device memory and pixel-budget gate documented in
`docs/WEB_CONVERTER_MOBILE_DEVICE_ACCEPTANCE.md`.

After a preview deployment passes, promote the reviewed commit to the production branch and keep
`imgconvert.web.casa` configured through **Pages → Custom domains**. The output contains `_headers`,
`robots.txt`, `sitemap.xml`, the marketing manifest, both language entries, and the isolated Web app.

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
