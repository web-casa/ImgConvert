<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.20 Mac App Store upload candidate

This release fixes SVG raster conversions being incorrectly reported as
skipped when the “Skip larger outputs” safeguard is enabled. SVG source markup
and a rasterized output are no longer compared by byte size.

It also defers low-frequency dialogs from the startup bundle and strengthens
the AppImage host file picker: dialog commands have a bounded timeout, retain
reported errors instead of silently treating them as cancellation, and drain
large selection results while waiting for completion.

The Mac App Store build keeps the v0.2.19 privacy manifest, minimal sandbox
entitlements, disabled updater and external codec helpers, and the reviewed
Media Library purpose string. See [`MAS_APP_REVIEW_SUBMISSION.md`](MAS_APP_REVIEW_SUBMISSION.md)
for the account-owner checks required before App Review submission.
