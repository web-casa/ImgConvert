<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.21 Mac App Store upload candidate

This release makes requested output formats conversion-first. ImgConvert now
writes the requested JPEG, PNG, WebP, or AVIF result even when it is larger
than the input. The “keep smaller outputs only” and generation-loss policies
remain available as explicit compression opt-ins.

Existing settings from releases where those policies were enabled by default
are migrated once to the new off-by-default behavior. This prevents a legacy
saved preference from silently reporting a required compatibility conversion
as skipped. SVG rasterization keeps its existing exemption because vector and
raster file sizes are not comparable.

The release also synchronizes the Snap package description with its Store
listing and documents the same conversion-first behavior across the app,
website, and package metadata.

The Mac App Store build retains the reviewed privacy manifest, minimal sandbox
entitlements, disabled updater and external codec helpers, and the Media
Library purpose string. See [`MAS_APP_REVIEW_SUBMISSION.md`](MAS_APP_REVIEW_SUBMISSION.md)
for the account-owner checks required before App Review submission.
