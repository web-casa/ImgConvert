<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.23 cross-platform build candidate

This candidate integrates the reviewed workflow and security work completed
after the public v0.2.22 release. It is a build candidate only until every
required direct-distribution and Store artifact has passed its native runner
checks.

## Product changes

- Adds batch resize rules, scenario presets, target-size encoding, configurable
  metadata privacy, and an exact before/after comparison preview.
- Adds one-way PDF rasterization input with bounded parsing, page selection,
  cancellation, and per-page output reporting.
- Refreshes the desktop UI while preserving keyboard focus containment,
  bilingual messages, output-safety confirmations, and conversion semantics.
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
  arm64 before a Release can leave draft state.
- macOS direct DMGs must be Developer ID signed, notarized, stapled, and pass
  Gatekeeper checks.
- MAS and Microsoft Store workflows are run in build-only mode for this
  candidate; no Store upload or review submission is authorized by this record.
- Windows direct installers remain intentionally unsigned, must pass install
  smoke, and require the documented SmartScreen warning if later published.
