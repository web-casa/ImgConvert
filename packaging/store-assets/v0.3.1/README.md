# ImgConvert v0.3.1 Store promotional assets

This directory contains bilingual creative masters for the Mac App Store and
Microsoft Store.

## Deliverables

- `mas/{en-US,zh-CN}/`: five 2880×1800 opaque PNG promotional screenshots per locale.
- `ms-store/{en-US,zh-CN}/`: five 1920×1080 opaque PNG product screenshots per locale.
- `ms-store/shared/super-hero-3840x2160.png`: text-free 16:9 Microsoft Store Super hero art.
- `preview/`: contact sheets for review only; do not upload these sheets to a store.

The sequence covers the batch workspace, batch resize rules, privacy metadata,
format/quality controls, and the supported import surface. HEIC and PDF wording
is deliberately bounded: PDF is import-only and converted page by page; HEIC
input depends on an available system or optional decoder.

## Submission boundary

The current UI layers were captured from the v0.3.1 browser preview so the
creative layout can be reviewed on this Linux workstation. They are **not** a
substitute for final platform evidence. Before store submission:

1. Capture the same five states from the signed MAS candidate and the final
   Store-candidate MSIX.
2. Confirm that no browser-preview status or sample labels remain.
3. Replace the UI layer while keeping the approved copy and layout.
4. Re-run the dimension/opacity checks below.

The Microsoft Store Super hero art is independent of the UI capture and is
already laid out without text, logos, devices, or interface imagery.

## Rebuild and validate

Run `pnpm store:assets:render`. The renderer starts the local Vite preview when
one is not already listening at `http://127.0.0.1:1420`. Set
`IMGCONVERT_STORE_CAPTURE_URL` to use another preview endpoint.

Recommended validation:

```sh
identify packaging/store-assets/v0.3.1/mas/*/*.png
identify packaging/store-assets/v0.3.1/ms-store/*/*.png
```

Mac App Store screenshots use Apple's accepted 16:10 2880×1800 size. Microsoft
Store product screenshots are landscape 1920×1080 PNGs, and the separate Super
hero art is 3840×2160.

## Generated-art provenance

The Super hero source was generated with the built-in OpenAI image generation
tool and then fitted to the exact Store canvas by the deterministic renderer.
Final prompt:

> Create a premium 16:9 desktop software store hero artwork for ImgConvert, an
> offline-first batch image and PDF converter. A sculptural circular conversion
> engine made from translucent warm-ivory glass and brushed dark forest-green
> metal, with several floating photographic image sheets and one subtle PDF page
> entering from the left, emerging as crisp image tiles on the right. Include a
> restrained coral-orange accent and tiny chartreuse status lights. Deep
> forest-green studio background, elegant editorial lighting, tactile
> precision-engineered materials, spacious cinematic composition. Keep the main
> visual centered and mostly within the upper two-thirds; leave the bottom third
> visually quiet for Microsoft Store cropping. Absolutely no words, no letters,
> no numbers, no logos, no app UI, no device frames, no badges, no watermarks.
> Clean, sophisticated, believable product visualization, not a playful cartoon,
> not generic neon tech, no excessive glow. Landscape 16:9, very high detail.

The selected source then received one conservative built-in image-edit pass:

> Edit this existing ImgConvert store hero artwork conservatively. Preserve the
> entire composition, camera, lighting, dark forest-green palette, circular
> conversion engine, floating photo tiles, spacing, and 16:9 framing. Change
> only the leftmost incoming document sheet: remove every printed line, chart,
> symbol, glyph, letter, and number from it, making it a completely blank
> warm-ivory paper surface with subtle realistic paper texture and edge
> lighting. Also remove any other accidental text-like marks or readable glyphs
> anywhere in the artwork. Keep the result free of all words, letters, numbers,
> logos, app UI, device frames, badges, and watermarks. Do not add new objects.

References:

- Apple screenshot specifications: <https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/>
- Microsoft screenshot and image specifications: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images>
