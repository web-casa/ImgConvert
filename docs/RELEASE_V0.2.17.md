<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.17 Mac App Store Media Library privacy fix

This release addresses the App Review finding for the macOS Media Library
purpose string.

## What changed

- Both direct macOS and Mac App Store configurations merge
  `src-tauri/Info.macos.privacy.plist`.
- `NSAppleMusicUsageDescription` now explains the actual, narrow use: ImgConvert
  scans only folders a person explicitly selects to find images for local
  conversion. It gives album-art conversion as a concrete example and states
  that the app does not read Apple Music playback or listening activity.
- The final MAS package verifier requires that exact purpose string, so a
  release cannot pass its local/CI artifact check if the key is missing or the
  wording is replaced.
- The in-app and public privacy policies use the same description.

## App Review note

Paste the following into App Store Connect's **Notes** field when submitting
this build:

> ImgConvert processes only files or folders the reviewer explicitly selects
> and performs conversion locally. If a reviewer selects a folder in the macOS
> Media Library privacy domain, the app may request Media Library permission
> solely to scan that selected folder for image files (for example, album-art
> images) and add them to the conversion queue. It does not query the Apple
> Music catalog or read playback/listening activity. The app does not access
> Photos, Contacts, Camera, Microphone, or Location. The Mac App Store build
> does not include the in-app updater or external codec helpers.

## macOS acceptance check

On a clean macOS test account, launch the signed Mac App Store candidate and
confirm that it does not ask for Media Library access at launch. Then select a
folder in the protected Media Library location and confirm that the system
prompt uses the v0.2.17 purpose string. Check both choices: **Allow** permits
image import from that selected location; **Don't Allow** leaves the rest of
ImgConvert usable and prevents only that protected-location import.
