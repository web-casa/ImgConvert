<!-- SPDX-License-Identifier: Apache-2.0 -->

# macOS Packaging

This directory documents the first macOS release surface.

- Direct distribution uses Tauri's automatic `src-tauri/tauri.macos.conf.json` merge and `entitlements.macos.direct.plist`.
- Mac App Store builds must use the generated config from `pnpm run release:macos:mas:prepare` and set `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` before compiling, so optional external codec/helper discovery is compiled off. MAS builds also set `IMGCONVERT_DISABLE_UPDATER=1`; updates are delivered by the App Store, never by Tauri updater.
- The MAS entitlement set is intentionally narrow: App Sandbox, user-selected read/write files, and app-scoped bookmarks. Do not add broad network or filesystem entitlements without a concrete feature need.
- HEIC import uses the macOS system ImageIO framework as a read-only `system-imageio` provider. It does not link libheif, does not bundle x265, and does not enable HEIC output until encoding, patents, and sandbox behavior are separately audited.
- Runtime file access is routed through Tauri dialog `fileAccessMode: "scoped"`, `tauri-plugin-fs`, `tauri-plugin-persisted-scope`, and the security-scoped resource shim in `src-tauri/src/macos_security.rs`. Dialog grants are added to the Tauri filesystem scope and persisted across launches; every backend path access still balances start/stop access with RAII.

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
export IMGCONVERT_MAS_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: <name> (<TEAMID>)"
pnpm run release:macos:mas:pkg
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

- Manual `macOS Smoke` runs on `macos-15` arm64, including the Apple Silicon AVIF benchmark and, by default, generated HEIC fixture import through ImageIO.
- Manual `build_direct=true` builds and uploads an unsigned `.dmg`.
- Manual `notarize_direct=true` imports Apple signing secrets, builds a signed `.dmg`, runs `notarytool`, staples it, then runs `codesign` and Gatekeeper checks.
- Manual `build_mas_candidate=true` imports Apple signing secrets, generates MAS entitlements/provisioning config, builds a signed `.app`, and optionally produces a `.pkg` when `IMGCONVERT_MAS_INSTALLER_IDENTITY` is set.
- The manual `macOS DMG Release` workflow is the v0.2.0 publication entrypoint. It checks out an exact `v<semver>` tag, verifies it against the app version, builds/signs/notarizes an arm64 DMG, and retains it as an Actions artifact. `publish_release=true` only attaches the verified DMG to an already-existing same-tag GitHub Release; it never creates a Release, changes its draft state, or uploads an unsigned artifact.

Required GitHub secrets:

- Direct signed/notarized DMG: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, plus either `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` or `APPLE_API_KEY`/`APPLE_API_ISSUER`/`APPLE_API_KEY_BASE64`.
- Optional direct overrides: `IMGCONVERT_DIRECT_SIGNING_IDENTITY` or `APPLE_SIGNING_IDENTITY`, and `APPLE_PROVIDER_SHORT_NAME`.
- MAS candidate: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_TEAM_ID`, `IMGCONVERT_MAS_PROVISION_PROFILE_BASE64`, and optionally `IMGCONVERT_MAS_SIGNING_IDENTITY` / `IMGCONVERT_MAS_INSTALLER_IDENTITY`.

macOS release acceptance still requires a real machine pass:

- HEIC `.heic/.heif` import through ImageIO in direct build.
- MAS sandbox file-open/output-directory flow using scoped dialog grants and persisted scope. The hidden path smoke covers the conversion backend; the interactive GUI permission prompt still needs a real acceptance pass.
- Apple Silicon AVIF benchmark has completed on `macos-15` arm64; rerun it before changing the rav1e default or codec choice.
- `.dmg` Developer ID signing, `notarytool` submission, stapling, and Gatekeeper assessment.
- App Store Connect upload/TestFlight/review remain account operations outside this repository.

The v0.2.0 direct-DMG release deliberately has no macOS Tauri updater asset or
endpoint. Until a separately reviewed `.app.tar.gz` updater artifact and
manifest exist, users obtain later macOS releases from GitHub manually. The
exact two-channel v0.2.0 order is documented in
[`docs/RELEASE_V0.2.0.md`](../../docs/RELEASE_V0.2.0.md).
