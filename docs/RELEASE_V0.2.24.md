<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.24 cross-platform release candidate

This candidate carries the reviewed workflow, PDF, security, and UI work since
the public v0.2.22 release. It remains unpublished until every required direct
artifact has passed its native build, signing, installation, and runtime gates.

## Product changes

- Adds batch resize rules, scenario presets, target-size encoding, configurable
  metadata privacy, and an exact before/after comparison preview.
- Adds one-way PDF rasterization input with bounded parsing, page selection,
  cancellation, and per-page output reporting.
- Adds a compact supported-format disclosure in the import area so common
  images, optional HEIC/HEIF input, PDF input, and export formats remain visible
  without overflowing narrow desktop windows.
- Adds metadata-only result caching and a shared workflow engine used by batch
  conversion and preview.

## Security and reliability

- Normalizes AVIF container orientation and EXIF/XMP orientation consistently.
- Hardens import paths, output authorization, helper process termination,
  panic boundaries, cache paths, and PDF/resource budgets.
- Expands fuzz replay, desktop E2E, release guardrails, capability checks, and
  release-readiness validation.

## Candidate policy

- GitHub direct artifacts must cover Linux, macOS, and Windows on x64/amd64 and
  arm64 before the draft Release can be published.
- macOS direct DMGs must be Developer ID signed, notarized, stapled, and pass
  Gatekeeper checks.
- MAS uses a signed universal package with upload disabled. Microsoft Store uses
  untouched x64/arm64 submission MSIX packages with sideload smoke on copies.
- Windows direct installers remain intentionally unsigned, must pass install
  and conversion smoke, and require the documented SmartScreen warning.
- No Store upload, review submission, or public GitHub Release is authorized by
  this candidate record.
