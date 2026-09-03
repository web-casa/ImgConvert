# ImgConvert independent codecs spike

This isolated `WEB-001B` candidate replaces the stock ImageMagick WASM bundle with four narrowly
scoped jSquash codecs. It is not part of the public website or desktop application build.

The candidate validates:

- JPEG, PNG, WebP, and AVIF in a serial Web Worker;
- the full 4 × 4 conversion matrix in Chromium, Firefox, and WebKit;
- real transparent pixels, explicit JPEG-to-white flattening, and metadata removal by pixel-only
  decode/re-encode;
- invalid-input recovery and hard cancellation by terminating and replacing the worker;
- same-origin-only codec loading under a restrictive Content Security Policy;
- exact npm versions, native-codec inventory, and SHA-256 pins for all nine shipped WASM variants.

```bash
pnpm --dir spikes/web-codecs install
pnpm --dir spikes/web-codecs technical:check
pnpm --dir spikes/web-codecs license:check
pnpm --dir spikes/web-codecs promotion:check
```

`licenses/native-codecs.json` is a reviewable SBOM-like inventory derived from the jSquash build
files at the pinned source revision. `license:check` verifies the installed npm manifests, rejects
AGPL/GPL/LGPL markers, and verifies each prebuilt WASM hash. This is an engineering policy gate,
not legal advice; a production release still needs a generated third-party notices asset containing
the required full license and attribution texts.

The upstream package declarations have known type-definition defects (an unresolved `meta.js`
specifier and unreferenced Emscripten globals). `skipLibCheck` is therefore enabled only in this
isolated spike; strict checking remains enabled for all local TypeScript source.
