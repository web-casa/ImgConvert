<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.19 verified Mac App Store candidate

`v0.2.18` was never signed, packaged, or uploaded: its macOS CI stopped at the
pinned Rust formatter before signing began. Release tags are immutable, so this
new version carries the same reviewed source plus the formatter's mechanical
changes.

The candidate includes the SVG, static GIF, and BMP input support; bounded
resource handling for AVIF, HEIC, thumbnails, and source files; the packaged
privacy manifest; the minimal Mac App Store entitlement set; and the recorded
App Review checklist. See [`RELEASE_V0.2.18.md`](RELEASE_V0.2.18.md) for the
feature and security details and
[`MAS_APP_REVIEW_SUBMISSION.md`](MAS_APP_REVIEW_SUBMISSION.md) for the exact
account-owner acceptance steps and Review Notes.
