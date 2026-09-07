# ImgConvert Web conversion runtime

`@imgconvert/web-conversion-runtime` owns the browser-native codec adapters and Worker executors
shared by the Web app and Chromium extension. It has no dependency on Svelte, WXT, browser
extension APIs, routing, or PWA state.

The root export contains only lightweight archive protocol and filename helpers. Codec executors
use explicit worker-only subpaths so importing the root cannot pull WASM or PDF.js into an
application's initial bundle:

- `@imgconvert/web-conversion-runtime/workers/raster`
- `@imgconvert/web-conversion-runtime/workers/svg`
- `@imgconvert/web-conversion-runtime/workers/pdf`
- `@imgconvert/web-conversion-runtime/workers/archive`

Each application keeps a thin worker entrypoint that calls the matching `register*Worker(self)`
function. The application also keeps the direct Vite/WXT-recognized
`new Worker(new URL(..., import.meta.url), { type: "module" })` constructor.
