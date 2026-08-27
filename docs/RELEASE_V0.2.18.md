<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.18 image-format support and Mac App Store hardening

This release adds three user-requested import formats and carries the complete
set of Mac App Store privacy and input-safety fixes into a new, immutable build.

## What changed

- SVG, static GIF, and BMP can now be imported, converted, and compressed to
  JPEG, PNG, WebP, or AVIF. They are deliberately input-only formats, so the
  output chooser continues to offer only the supported encoders.
- SVG rendering is local and bounded: source text is capped at 16 MiB, the
  declared canvas must fit the shared 64 MP limit, and external or data-URI
  image references are rejected rather than read or silently omitted.
- Animated GIFs are rejected before pixel decode so the app never writes a
  misleading first-frame-only result.
- AVIF and system HEIC decoders validate dimensions before expensive image
  allocation. Input, bridge-PNG, and thumbnail reads have bounded sizes, and
  batch memory accounting includes input buffers.
- Directory imports skip symlink targets outside the directory selected by the
  person. User-selected HEIC helpers use the same trusted-directory checks as
  discovered helpers, and cancelling during planning prevents a later batch
  launch.
- The Mac App Store bundle includes `PrivacyInfo.xcprivacy`, declaring no
  tracking or collected data and the File Timestamp required-reason API
  (`3B52.1`) for metadata of user-selected files and folders. Its final bundle
  check is part of the MAS artifact verification.
- The unused app-scoped bookmark entitlement is removed. The remaining MAS
  entitlements are App Sandbox, user-selected read/write file access, and the
  local Tauri/WKWebView IPC network client entitlement.

## App Review Notes

Use the current review-note block in
[`MAS_APP_REVIEW_SUBMISSION.md`](MAS_APP_REVIEW_SUBMISSION.md). It explains the
Media Library prompt, local-only processing, Tauri local IPC, and the absence
of an updater or external codec helpers in the Mac App Store build.

## Required macOS acceptance

On a clean physical macOS account, run the exact processed build through the
steps in [`MAS_APP_REVIEW_SUBMISSION.md`](MAS_APP_REVIEW_SUBMISSION.md): reset
`MediaLibrary` permission, record both Allow and Don't Allow paths, complete a
conversion after selecting an output folder, then relaunch and select the
output folder again. Also import one SVG, one static GIF, and one BMP, and
confirm that an animated GIF is clearly rejected.
