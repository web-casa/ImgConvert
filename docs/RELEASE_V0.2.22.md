<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.22 GitHub direct release candidate

This release carries the conversion-first behavior from v0.2.21 into the
direct GitHub distribution channel. Requested JPEG, PNG, WebP, and AVIF
outputs are written even when they are larger than their inputs unless an
optional compression policy is explicitly enabled.

The release fixes the Windows HEIC CI harness introduced with the shared
64 MP decoded-image guardrail. The WIC bridge now resolves the common
dimension validator through its parent module, while the isolated codec test
harness exposes the same core validation surface. This restores native
Windows HEIC compilation coverage without weakening the production limit.

The GitHub Release is created as a draft first. Signed updater assets are
published by the manual `Updater Release` workflow, and the tag-triggered
Linux amd64/arm64 artifacts are attached only after the provenance-checking
`Linux Release Assets Finalize` workflow succeeds.
