<!-- SPDX-License-Identifier: Apache-2.0 -->

# macOS Packaging

This directory documents the first macOS release surface.

- Direct distribution uses Tauri's automatic `src-tauri/tauri.macos.conf.json` merge, `entitlements.macos.direct.plist`, and the shared `Info.macos.privacy.plist` purpose strings.
- Mac App Store builds must use the generated config from `pnpm run release:macos:mas:prepare` and set `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` before compiling, so optional external codec/helper discovery is compiled off. The MAS command builds one universal `arm64` + `x86_64` app with Tauri's `universal-apple-darwin` target. MAS builds also set `IMGCONVERT_DISABLE_UPDATER=1`; updates are delivered by the App Store, never by Tauri updater.
- The MAS entitlement set is intentionally narrow: App Sandbox, network client access for Tauri/WKWebView's local IPC endpoint, and user-selected read/write files. It intentionally omits app-scoped bookmarks because the app does not create or restore macOS bookmark data. Do not add broad network or filesystem entitlements without a concrete feature need.
- `Info.macos.privacy.plist` supplies the same Media Library usage description to direct and MAS builds. It explains that recursive import scans only folders the person explicitly selects, such as a selected media-library folder containing album-art images; it does not grant, add, or justify broad Music-library access.
- `PrivacyInfo.xcprivacy` is a Tauri bundle resource, so it lands at `Contents/Resources/PrivacyInfo.xcprivacy` in the macOS app. It declares no tracking or data collection and declares File Timestamp access (`3B52.1`) only for user-selected files or folders.
- HEIC import uses the macOS system ImageIO framework as a read-only `system-imageio` provider. It does not link libheif, does not bundle x265, and does not enable HEIC output until encoding, patents, and sandbox behavior are separately audited. Still HEIC/HEIF files are supported; multi-frame inputs are rejected rather than silently converting only frame zero.
- Runtime file access is routed through standard Tauri desktop dialogs, `tauri-plugin-fs`, `tauri-plugin-persisted-scope`, and the security-scoped resource shim in `src-tauri/src/macos_security.rs`. On macOS, the app requires a user-selected output folder once per app launch; that `NSOpenPanel` selection grants the current sandboxed process write access to the folder and its contents. A persisted Tauri filesystem scope is not a macOS security-scoped bookmark and is never used as cross-launch write authorization. Tauri's desktop `fileAccessMode` setting is iOS-only, so the app deliberately does not rely on it. Every backend path access still balances start/stop access with RAII when a platform grant is available.

Local preflight from any host:

```bash
pnpm run release:macos:check
IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 pnpm run release:macos:store:check
pnpm run release:macos:smoke -- --allow-non-macos --skip-benchmark --skip-heic
```

Direct distribution build on macOS:

```bash
pnpm run release:macos
pnpm run release:macos:verify
```

Direct distribution signing/notarization checklist:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<TEAMID>)"
export APPLE_ID="<apple-id>"
export APPLE_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<TEAMID>"
pnpm run release:macos
pnpm run release:macos:notarize
```

MAS candidate build on macOS, after Apple signing/provisioning is configured:

```bash
export APPLE_TEAM_ID="<TEAMID>"
export APPLE_SIGNING_IDENTITY="Apple Distribution: <name> (<TEAMID>)"
export IMGCONVERT_MAS_PROVISION_PROFILE=/path/to/embedded.provisionprofile
pnpm run release:macos:mas  # sets IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 and IMGCONVERT_DISABLE_UPDATER=1
export IMGCONVERT_MAS_INSTALLER_IDENTITY="Mac Installer Distribution: <name> (<TEAMID>)"
pnpm run release:macos:mas:pkg
export APPLE_ID="<apple-id>"
export APPLE_PASSWORD="<app-specific-password>"
pnpm run release:macos:mas:submit              # App Store Connect validation only
pnpm run release:macos:mas:submit -- --upload  # validate, then upload
```

Apple Silicon AVIF benchmark, used to decide whether rav1e speed 8 remains a sane default on macOS:

```bash
pnpm run bench:avif:macos
IMGCONVERT_AVIF_BENCHMARK_SPEEDS=6,8,10 IMGCONVERT_AVIF_BENCHMARK_ITERATIONS=5 pnpm run bench:avif:macos
```

The manual `macOS Smoke` workflow runs the same release-profile benchmark on the
free public `macos-15` arm64 runner and retains the resulting
`imgconvert-macos-arm64-avif-benchmark` JSON artifact for 14 days. Use its log
and artifact together when recording a default-speed decision; do not infer
Apple Silicon performance from a non-macOS preflight.

Runtime smoke on macOS:

```bash
pnpm run release:macos:smoke
IMGCONVERT_MACOS_HEIC_SMOKE_INPUT=/path/to/sample.heic pnpm run release:macos:smoke
pnpm run release:macos:smoke -- --build-direct
pnpm run release:macos:smoke -- --notarize-dmg=/path/to/ImgConvert.dmg --notary-profile=<profile>
pnpm run release:macos:notarize -- --dmg=/path/to/ImgConvert.dmg --keychain-profile=<profile>
```

GitHub Actions:

- Manual `macOS Smoke` runs on `macos-15` arm64, including the Apple Silicon AVIF benchmark and, by default, generated HEIC fixture import through ImageIO. Manual `macOS Intel Smoke` runs the same ImageIO fixture path on `macos-15-intel`; run it before a tagged release.
- Manual `build_direct=true` builds and uploads an unsigned `.dmg`.
- Manual `notarize_direct=true` imports Apple signing secrets, builds a signed `.dmg`, runs `notarytool`, staples it, then runs `codesign` and Gatekeeper checks.
- Manual `build_mas_candidate=true` imports separate Apple Distribution and Mac Installer Distribution certificates, verifies the embedded provisioning profile and signed entitlements, builds a signed universal `.app`, and requires a signed `.pkg` artifact. Artifact checks verify `file`, `lipo -archs`, `otool -L`, the ImageIO linkage, and the absence of linked `libheif`/`libx265`.
- The manual `macOS DMG Release` workflow is the direct-distribution publication entrypoint. It checks out an exact `v<semver>` tag, verifies it against the app version, then builds, signs, and submits separate arm64 and Intel x64 DMGs on the free standard `macos-15` and `macos-15-intel` runners. Run `macOS Notarization Finalize` once per architecture after Apple accepts each submission. `publish_release=true` only attaches a verified DMG to an already-existing same-tag GitHub Release; it never creates a Release, changes its draft state, or uploads an unsigned artifact.
- The manual `macOS MAS Release` workflow checks out the same immutable tag, requires that commit to be on the default branch, builds a signed sandboxed universal `.app` and Installer-signed `.pkg`, and validates the package with App Store Connect. `upload_build=false` is the safe default; set it to true only after validation succeeds and the App Store Connect app record is ready.

Required GitHub secrets:

- Direct signed/notarized DMG: `APPLE_DIRECT_CERTIFICATE`, `APPLE_DIRECT_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, plus either `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` or `APPLE_API_KEY`/`APPLE_API_ISSUER`/`APPLE_API_KEY_BASE64`.
- Optional direct overrides: `IMGCONVERT_DIRECT_SIGNING_IDENTITY` and `APPLE_PROVIDER_SHORT_NAME`.
- MAS candidate/submission: `APPLE_MAS_CERTIFICATE`, `APPLE_MAS_CERTIFICATE_PASSWORD`, `APPLE_MAS_INSTALLER_CERTIFICATE`, `APPLE_MAS_INSTALLER_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_TEAM_ID`, `IMGCONVERT_MAS_PROVISION_PROFILE_BASE64`, `APPLE_ID`, and `APPLE_PASSWORD`. The workflow auto-selects both MAS identities; `IMGCONVERT_MAS_SIGNING_IDENTITY`, `IMGCONVERT_MAS_INSTALLER_IDENTITY`, and `APPLE_PROVIDER_SHORT_NAME` are optional overrides.

macOS release acceptance still requires a real machine pass:

- HEIC `.heic/.heif` import through ImageIO in both the arm64 and Intel direct builds, plus multi-frame rejection behavior.
- MAS sandbox file-open/output-directory flow, including a fresh output-folder selection after relaunch. The hidden path smoke covers the conversion backend; the interactive GUI permission prompt still needs a real acceptance pass.
- Apple Silicon AVIF benchmark has completed on `macos-15` arm64; rerun it before changing the rav1e default or codec choice.
- `.dmg` Developer ID signing, `notarytool` submission, stapling, and Gatekeeper assessment.
- App Store Connect package validation and optional build upload are automated. Build processing, metadata, TestFlight selection, pricing/availability, physical-machine sandbox testing, and App Review submission remain explicit account-owner steps. Use [`docs/RELEASE_QA.md`](../../docs/RELEASE_QA.md) as the cross-platform acceptance record.

The v0.2.1 direct-DMG release deliberately has no macOS Tauri updater asset or
endpoint. Until a separately reviewed `.app.tar.gz` updater artifact and
manifest exist, users obtain later macOS releases from GitHub manually. The
exact v0.2.1 release order is documented in
[`docs/RELEASE_V0.2.1.md`](../../docs/RELEASE_V0.2.1.md).
