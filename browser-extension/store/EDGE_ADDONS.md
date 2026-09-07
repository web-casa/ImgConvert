# Microsoft Edge Add-ons listing — ImgConvert

> Last updated: 2026-09-04
>
> Status: **PRE-RELEASE EVIDENCE PARTIAL — DO NOT UPLOAD OR PUBLISH**

## Properties and availability

- Category: `Photos`
- Website: <https://imgconvert.web.casa/>
- Support: <https://github.com/web-casa/ImgConvert/issues>
- Proposed visibility: Public
- Proposed markets: All markets
- Developer/organization name: Partner Center account owner must confirm; not inferred from Git

## Privacy fields

- Single purpose: ImgConvert locally converts user-selected images and PDF pages into JPEG, PNG,
  WebP, or AVIF in a visible browser workbench.
- Permission justifications: use the exact `storage`, `contextMenus`, `sidePanel`, and optional `https://*/*`
  explanations in the root `CHROMEWEBSTORE.md`; the Edge ZIP declares the same minimum permissions.
  Its `homepage_url` is metadata for the canonical website and grants no host access.
- Remote code: **No.** All executable files are packaged; selected HTTPS images are data only.
- Data usage: conservatively disclose Website content and Web history for the one image URL/origin
  explicitly selected by the user. Do not select PII, health, financial, authentication, personal
  communications, location, or general user-activity collection.
- English privacy URL: <https://imgconvert.web.casa/en/privacy/>
- Simplified Chinese privacy URL: <https://imgconvert.web.casa/privacy/>

## English (`en` / Partner Center `en-US`)

- Extension name: `ImgConvert`
- Short description (read-only from manifest): `Convert images locally in your browser, with batch processing, previews, and adjustable quality.`
- Description: use the English detailed description in the root `CHROMEWEBSTORE.md` (more than 250
  and fewer than 10,000 characters).
- Logo: `assets/v0.3.4/shared/edge-store-logo-300.png`
- Screenshots, in order: the five files under `assets/v0.3.4/en-US/`
- Small promotional tile: `assets/v0.3.4/shared/small-promo-440x280.png`
- Large promotional tile: `assets/v0.3.4/shared/marquee-promo-1400x560.png`
- Search terms: `image converter`; `WebP`; `AVIF`; `PDF to image`; `offline`; `batch conversion`;
  `privacy`

## Simplified Chinese (`zh_CN` / Partner Center `zh-CN`)

- Extension name: `ImgConvert`
- Short description (read-only from manifest): `在浏览器本地转换图片，支持批量处理、结果预览和质量调整。`
- Description: use the Simplified Chinese detailed description in the root `CHROMEWEBSTORE.md`
  (more than 250 and fewer than 10,000 characters).
- Logo: `assets/v0.3.4/shared/edge-store-logo-300.png`
- Screenshots, in order: the five files under `assets/v0.3.4/zh-CN/`
- Small promotional tile: `assets/v0.3.4/shared/small-promo-440x280.png`
- Large promotional tile: `assets/v0.3.4/shared/marquee-promo-1400x560.png`
- 搜索词：`图片转换`；`WebP`；`AVIF`；`PDF 转图片`；`离线`；`批量转换`；`隐私`

## Certification notes

Use `reviewer-notes.en-US.txt` in the Partner Center certification field. No login or test account is
required. The local draft intentionally performs no Partner Center create, upload, publish, or
certification action.

The actual workbench includes explicit links to the official website, localized documentation and
privacy pages, desktop downloads, and source repository. They open in a new tab only after a user
click and do not add a permission or load remote code into the extension.

## External blockers

The previous Edge 152 Allow/Deny evidence predates the Side Panel manifest and UI change and must be
rerun against the current build. The publisher must also resolve the account identity and
deploy/reverify the updated disclosure on the canonical production privacy URLs. The exact evidence
and remaining authorization gate are listed in the root `CHROMEWEBSTORE.md`; no Partner Center upload
is permitted before they pass.
