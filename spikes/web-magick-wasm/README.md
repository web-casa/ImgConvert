# ImgConvert magick-wasm spike

This package is an isolated WEB-001 experiment. It is not part of the public website or desktop
application build.

It verifies the locally hosted `@imagemagick/magick-wasm` browser worker, the JPEG/PNG/WebP/AVIF
conversion matrix, metadata stripping, cancellation-by-worker-termination, and production asset
sizes. Findings belong in `docs/WEB_CONVERTER_P0_REPORT.md`; unverified behavior must not be treated
as a product capability.

```bash
pnpm --dir spikes/web-magick-wasm install
pnpm --dir spikes/web-magick-wasm build
pnpm --dir spikes/web-magick-wasm test
pnpm --dir spikes/web-magick-wasm license:report
pnpm --dir spikes/web-magick-wasm promotion:check
```

The test starts a loopback-only Vite preview, runs the full matrix in Playwright Chromium, Firefox,
and WebKit, verifies native decoding and same-origin-only requests, then terminates an active worker
and confirms that a replacement worker can complete another matrix.

The package-level Apache-2.0 declaration is not sufficient for promotion. `license:report` also
parses the bundled ImageMagick `NOTICE`; `license:check` fails when that artifact contains a component
forbidden by ImgConvert's AGPL/GPL/LGPL policy. Consequently, `promotion:check` is expected to fail
for this stock-package candidate even when `technical:check` passes.
