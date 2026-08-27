<!-- SPDX-License-Identifier: Apache-2.0 -->

# Mac App Store resubmission checklist

This checklist is for the exact signed `.pkg` that will be uploaded. A green
CI run is not evidence that App Store Connect metadata or macOS TCC behaviour
was tested.

## Repository safeguards

- `src-tauri/PrivacyInfo.xcprivacy` declares that ImgConvert does not track or
  collect data and declares the File Timestamp required-reason API with
  `3B52.1`: metadata is read only for files or folders the person selected.
  Tauri packages the file into `Contents/Resources/PrivacyInfo.xcprivacy`, and
  the MAS artifact checker verifies the final bundle.
- The MAS entitlement set is limited to App Sandbox, outgoing network client
  access for the bundled Tauri/WKWebView local IPC endpoint, and user-selected
  read/write file access. It intentionally does not request app-scoped
  bookmarks because this app neither creates nor restores macOS bookmark data.
- The MAS build removes the in-app updater and external codec helpers at build
  time. It uses system ImageIO only for local HEIC/HEIF input.

## Review Notes

Paste this block into App Store Connect **Notes** without expanding the app's
claimed capabilities:

> ImgConvert processes only files or folders the reviewer explicitly selects
> and performs conversion locally. If a reviewer selects a folder in the macOS
> Media Library privacy domain, the app may request Media Library permission
> solely to scan that selected folder for image files (for example, album-art
> images) and add them to the conversion queue. It does not query the Apple
> Music catalog or read playback/listening activity. The app does not access
> Photos, Contacts, Camera, Microphone, or Location.
>
> The sandbox profile includes `com.apple.security.network.client` so the
> bundled Tauri/WKWebView runtime can reach its local IPC endpoint. ImgConvert
> does not upload images, selected file paths, account data, analytics, or
> telemetry data. No account, payment, or cloud conversion service is needed.
>
> To test: launch the app, select a local JPEG, PNG, WebP, AVIF, or supported
> HEIC input, choose an output format, select an output folder, convert, and
> open the resulting local file. After relaunching, select the output folder
> again before converting. The Mac App Store build does not include the in-app
> updater or external codec helpers.

## Clean-account acceptance recording

Perform this on a physical Mac with the exact signed candidate (or the exact
processed TestFlight build), not a development build.

1. Create or use a clean macOS test account. Before each Media Library pass,
   reset only this app's decision:

   ```bash
   tccutil reset MediaLibrary com.ivmm.imgconvert
   ```

2. Launch ImgConvert. Confirm that no Media Library permission prompt appears
   at launch.
3. Use the native picker to select the protected Media Library location that
   triggers the prompt on that macOS version. Capture the purpose string.
4. Repeat the import after choosing **Allow**. Confirm that selected images
   enter the queue and that conversion completes.
5. Reset the permission again, repeat the same selection, and choose **Don't Allow**.
   Confirm that the protected import fails clearly while normal local
   imports and the rest of the app remain usable.
6. Record a continuous run: launch, import, select output folder, convert,
   open result, quit, relaunch, select the output folder again, and convert.
   This proves the per-launch output-directory grant rather than relying on a
   persisted path.

Apple documents `MediaLibrary` as the `tccutil` service corresponding to
`NSAppleMusicUsageDescription`. If a macOS release changes the prompt's
behaviour, record the OS version, exact selected location, and result rather
than changing the purpose string speculatively.

## App Store Connect owner checklist

- [ ] Confirm the updated age-rating questionnaire is complete.
- [ ] Confirm the App Privacy label says no data is collected only after
  checking that the submitted build and its services match that claim.
- [ ] Upload screenshots of the actual macOS app in use; do not submit website
  previews as product screenshots.
- [ ] Keep all store metadata accurate: do not claim universal image-format
  support or HEIC output. The MAS build supports HEIC/HEIF input only through
  ImageIO where macOS provides it.
- [ ] Use a fresh `CFBundleVersion` for any build that App Store Connect has
  already processed or reviewed. A build number can be reused only when its
  upload itself failed before processing.
- [ ] Attach the continuous clean-account recording and the final review notes
  to the release record before submitting for review.
