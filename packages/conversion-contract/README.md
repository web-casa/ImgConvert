# @imgconvert/conversion-contract

Data-only contracts shared by the ImgConvert Web UI, workers, and future browser extension.

This package intentionally has no DOM, Svelte, Tauri, codec, or network dependency. It defines:

- supported input/output identifiers plus the `WEB-001B` raster and `WEB-006` safe-SVG capability
  descriptors;
- immutable capability registration and lookup;
- Web v1 desktop resource ceilings;
- stable error codes with scalar-only localization parameters;
- conversion request/result DTOs and runtime request validation;
- the serial job state transition contract.

Descriptors only advertise behavior demonstrated by implemented adapters and tests. SVG currently
means the bounded static-vector `safe-svg-resvg` backend, not unrestricted browser SVG. PDF, BMP,
GIF, metadata preservation, and mobile resource budgets remain unavailable until their own adapters
and tests register those capabilities.

```bash
pnpm --dir packages/conversion-contract check
pnpm --dir packages/conversion-contract build
```
