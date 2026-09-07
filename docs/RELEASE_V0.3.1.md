<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.3.1 release

Published on 2026-09-02 at [GitHub Release v0.3.1](https://github.com/web-casa/ImgConvert/releases/tag/v0.3.1).
The public tag and asset inventory were checked through the GitHub API on 2026-09-05.

This release carries the workflow, PDF, security, UI, and external-link changes since v0.2.22.
It has no browser-extension ZIPs. It predates the release evidence gate added in
[the follow-up review fixes](PROJECT_REVIEW_RELEASE_FIXES_2026-09-05.md); its publication does
not imply that the historical assets have passed those new checks.

## Product changes

- Adds batch resize rules, scenario presets, target-size encoding, configurable
  metadata privacy, and an exact before/after comparison preview.
- Adds one-way PDF rasterization input with bounded parsing, page selection,
  cancellation, and per-page output reporting.
- Makes common images, optional HEIC/HEIF input, PDF input, and export formats
  discoverable without overflowing narrow desktop windows.
- Adds metadata-only result caching and a shared workflow engine used by batch
  conversion and preview.
- Adds fixed, user-initiated HTTPS entry points for the official website,
  source repository, and issue tracker. Store builds still contain no external
  installer, purchase flow, or in-app updater.

## Security and reliability

- Normalizes AVIF container orientation and EXIF/XMP orientation consistently.
- Hardens import paths, output authorization, helper process termination,
  panic boundaries, cache paths, PDF/resource budgets, and external-link
  capabilities.
- Expands fuzz replay, desktop E2E, release guardrails, capability checks, and
  release-readiness validation.

## Distribution policy at release time

- GitHub direct artifacts must cover Linux, macOS, and Windows on x64/amd64 and
  arm64 before the draft Release can be published.
- macOS direct DMGs must be Developer ID signed, notarized, stapled, and pass
  Gatekeeper checks.
- MAS uses a signed universal package with upload disabled. Microsoft Store uses
  untouched x64/arm64 submission MSIX packages at Store version `1.0.6.0`, with
  sideload smoke performed only on disposable copies.
- Windows direct installers remain intentionally unsigned, must pass install
  and conversion smoke, and require the documented SmartScreen warning.
- Snap, Flatpak, MAS, and Microsoft Store artifacts are independent channel
  candidates and do not replace required GitHub direct assets.
- No Store upload, review submission, Snap publication, or public GitHub Release
  is authorized by this candidate record.
