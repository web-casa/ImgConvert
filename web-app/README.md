# @imgconvert/web-app

Svelte/Vite application for ImgConvert Web at `/convert/`.

WEB-004 provides local file selection, drag-and-drop and clipboard import; serial bounded probing;
queue limits; cancellation, retry, removal and confirmed clearing; capability-driven output settings;
Chinese/English copy; light/dark themes; and responsive layouts.

WEB-005 adds real JPEG, PNG, WebP, and AVIF conversion in a serial Worker. It supports quality,
lossless output, exact resizing, JPEG alpha flattening, progress, active cancellation, output
re-probing, before/after comparison, safe file names, single-result download, and conversion again
from the original file. Inputs and outputs remain in browser memory and codec WASM loads on demand.

WEB-006 adds SVG input through a separate, lazy Worker. A strict streaming XML validator rejects
active content, external resources, CSS/style content, text requiring fonts, animation, entities,
unbounded structure and oversized canvases before `resvg-wasm` is loaded. Accepted static vector
artwork can be converted to JPEG, PNG, WebP or AVIF through the existing validated raster pipeline.

WEB-007 adds PDF input through a separate, lazy Worker and a nested self-hosted PDF.js Worker.
Page ranges and 72–600 DPI rendering are bounded by PDF byte, page-count, selected-page and pixel
limits. Pages render serially, then enter the existing validated raster pipeline; successful pages
remain downloadable when another selected page fails. Document JavaScript and password-protected
PDFs are rejected, annotations are disabled, and external links are never followed.

WEB-008 adds batch export without changing conversion ownership. Supporting Chromium browsers can
write verified outputs serially to a user-selected folder; existing files receive conflict-safe
numbered names instead of being overwritten. Every browser can create a lazy, local ZIP fallback
when its conservative estimate stays below 256 MiB. Partial batches include a bounded JSON failure
report, and ZIP generation can be cancelled by terminating its dedicated Worker.

WEB-009 makes `/convert/` an installable, scope-isolated PWA. The app shell is precached while
content-hashed Worker and WASM assets remain on demand and become available offline after use.
Navigation is network-first with an offline fallback; compatible updates wait for explicit user
approval. Browser storage contains only bounded settings, language and theme preferences. The Clear
Local Data action removes those preferences and ImgConvert-owned caches without deleting files in
the current memory-only queue or unrelated same-origin caches.

WEB-010 keeps `web-app/dist` independent, then assembles it into `website/dist/convert` through a
symlink- and traversal-rejecting release script. The final artifact gate preserves all marketing
routes, enforces `/convert/` resource and service-worker scope, confirms codec engines stay lazy,
and prepares a read-only smoke command for real Cloudflare Pages preview headers and MIME types.

WEB-011 completes the promised raster-input matrix with strictly probed 24/32-bit BMP and
single-frame GIF. GIF structure is scanned in full before conversion, animated GIF is rejected,
and the UI keeps a visible first-frame notice. BMP uses the browser decoder only after bounded
header, encoding, dimension and color-space checks; GIF decoding is isolated in the existing
raster Worker. The Worker re-probes transferred input bytes, verifies decoded dimensions, caps
result messages at 64 MiB, and accepts correctly formed outputs smaller than the normal 64-byte
probe window. Release review is reproducible through the local review and memory commands below.

SVG files that depend on live text, linked images or stylesheets should first be exported with text
converted to paths and all artwork embedded as static vector geometry.

## UI compatibility boundary

- `App.svelte` owns queue state, probe scheduling, conversion settings snapshots, Worker lifecycle,
  cancellation, Blob URLs, preview state, downloads, and batch-export orchestration.
- Components under `src/lib/` are presentation boundaries. They receive typed values and callbacks;
  they must not create a second conversion scheduler or duplicate queue ownership.
- `@imgconvert/conversion-contract` and `@imgconvert/web-image-engine` remain independent of Svelte
  and UI structure.
- Raster, SVG and PDF conversion use separate, lazy serial schedulers. Format routing stays in
  `App.svelte`; presentation components must not import Worker implementations. PDF page results
  remain children of one queue entry. WEB-008 derives a read-only export plan from those existing
  results; folder and archive code must not create a second queue owner.
- UI refactors must preserve semantic control names and pass `web:app:check`, the three-browser
  `web:app:e2e` suite, and the repository `quality:frontend` gate before the next milestone starts.

PDF.js 6.x requires Node 22.13 or newer for install/build tooling; project CI uses Node 24.

```bash
pnpm run web:app:dev
pnpm run web:app:check
pnpm run web:app:e2e
pnpm --dir web-app pwa:verify
pnpm run web:release:build
pnpm run web:release:review:local
pnpm run web:release:memory
pnpm run web:release:preview:smoke -- https://example.pages.dev
```
