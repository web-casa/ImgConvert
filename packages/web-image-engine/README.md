# @imgconvert/web-image-engine

Browser-specific image probing, Worker scheduling, cancellation, and resource enforcement for
ImgConvert Web. The package consumes the data-only `@imgconvert/conversion-contract` package and
does not expose codec implementation details to the UI.

`WEB-003` includes bounded JPEG, PNG, WebP, and AVIF container probes plus a serial Worker
scheduler. Probe functions accept a caller-provided prefix plus the full source byte length so
browser adapters can use `File.slice()` without reading an entire untrusted file into memory.

`WEB-005` adds the raster conversion boundary used by the codec Worker: bilinear resize, selected
background alpha flattening for JPEG, output byte limits, safe download names, color-profile
fail-closed behavior, and mandatory output header plus decoded-pixel validation. Codec loading stays
inside the Worker; the UI only receives stable outcomes and progress phases.

`WEB-006` adds a fail-closed SVG boundary. `probeSvg()` uses a strict streaming parser, bounded
source/structure/filter/path budgets, a local-fragment-only reference policy, and raster pixel
ceilings. It intentionally accepts static vector geometry only: scripts, events, animation,
`foreignObject`, text/fonts, CSS, linked images, DTD/entities, processing instructions and foreign
namespaces are rejected. `convertSvgRequest()` revalidates the original bytes in the SVG Worker,
checks the resvg-produced PNG dimensions and container, then reuses the raster conversion boundary.

`SerialConversionScheduler.enqueue()` validates and freezes the request, then immediately transfers
ownership of `request.input.bytes` into the scheduler without copying it. The caller's ArrayBuffer is
detached after a successful enqueue and must not be reused. Active cancellation and timeouts
terminate the Worker; the next job receives a fresh Worker, and late events from the old instance are
ignored.

```bash
pnpm run web:engine:check
pnpm run web:engine:build
```
