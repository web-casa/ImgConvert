<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tauri Updater Release

ImgConvert uses the Tauri v2 updater with a static `latest.json` hosted on
GitHub Releases:

```text
https://github.com/web-casa/ImgConvert/releases/latest/download/latest.json
```

The default `src-tauri/tauri.conf.json` keeps an inert `plugins.updater` object
with empty pubkey/endpoints so the updater plugin can initialize in normal
packages. Signed updater release builds opt in by generating an extra Tauri
config that overlays the real pubkey and endpoints.

`v0.1.2` was a Linux-only public Release. The v0.2.0 release plan keeps Linux
updater assets on GitHub Releases and adds a separate, signed/notarized direct
macOS DMG. The DMG is a manual-download artifact in v0.2.0: this repository
does not yet publish a signed macOS `.app.tar.gz` plus updater manifest, so it
must not claim an in-app macOS update channel. Microsoft Store MSIX remains a
separate submission artifact and is never a GitHub direct-download asset.

## One-time key setup

Generate the updater signing key pair on a trusted machine:

```bash
pnpm tauri signer generate --ci -w ~/.tauri/imgconvert-updater.key
```

Store these GitHub repository secrets:

- `TAURI_UPDATER_PUBKEY`: contents of `~/.tauri/imgconvert-updater.key.pub`
- `TAURI_SIGNING_PRIVATE_KEY`: contents of `~/.tauri/imgconvert-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional, only if the key has a password

Do not commit either key.

## Local signed AppImage updater build

If the key pair is stored at the default path, the local release command loads
the private key only into child process environment variables and does not write
it into the repository:

```bash
pnpm run release:updater:local
```

That command builds the updater-enabled AppImage, scrubs it, re-signs the final
artifact, writes `target/updater/latest.json`, and verifies that the manifest
matches the local artifact and `.sig`.

The default updater endpoint is:

```text
https://github.com/web-casa/ImgConvert/releases/latest/download/latest.json
```

The default artifact base URL follows the application version, for example:

```text
https://github.com/web-casa/ImgConvert/releases/download/v0.2.0
```

Override these when preparing a non-default repository or tag:

```bash
export TAURI_UPDATER_PUBKEY="$(cat ~/.tauri/imgconvert-updater.key.pub)"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/imgconvert-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
export TAURI_UPDATER_ENDPOINTS='["https://github.com/web-casa/ImgConvert/releases/latest/download/latest.json"]'

pnpm run release:linux:updater

export TAURI_UPDATER_ARTIFACT_BASE_URL="https://github.com/web-casa/ImgConvert/releases/download/v0.2.0"
pnpm run release:updater:manifest
pnpm run release:updater:verify
```

The Linux updater path scrubs the AppImage first, then re-signs the final
AppImage with `tauri signer sign`. This avoids publishing a signature for a
pre-scrub artifact. The verify step checks that `latest.json` points at the
final local artifact and that each manifest signature matches the adjacent
`.sig` file.

The build verifies each updater signature cryptographically with the configured
Tauri public key. It then produces checksum manifests in two different
directories. The publication job verifies both of them, ensures `latest.json`
uses this repository and release tag, rejects duplicate GitHub asset names, then
stages the following flat asset set for the GitHub Release:

- `latest.json`
- `ImgConvert-<version>-x86_64.AppImage` and its `.sig`
- the Tauri updater AppImage and its `.sig`
- one merged `SHA256SUMS`, initially covering `latest.json`, every published
  updater AppImage, and signature

Do not attach both build-time files named `SHA256SUMS` directly: GitHub Release
asset names are flat, so the later upload would overwrite the earlier one.

After the tag-triggered Linux package matrix succeeds, run `Linux Release
Assets Finalize` from `main` with its run ID and the same tag. It accepts only
the successful `Linux Release` tag-push run from this repository, verifies both
artifact checksum manifests, and attaches the non-conflicting `.deb`, `.rpm`,
and arm64 AppImage files. Every GitHub Release asset attachment then refreshes
only the release-level `SHA256SUMS` into a manifest covering the complete public
release set. The Linux finalizer does not rebuild packages or receive the
updater signing key.

Before uploading the first GitHub Releases batch, run the local read-only gate:

```bash
pnpm run release:readiness:github:ready
```

It fails if the Linux packages, checksums, AppImage updater signature,
`latest.json`, or updater prerequisites are still missing for the GitHub-only
release scope.

After the release is published, verify the public updater surface:

```bash
pnpm run release:updater:smoke -- --repo=web-casa/ImgConvert --tag=v0.2.0 --platform=linux-x86_64
```

On a different CPU architecture, add `--no-run` to validate `latest.json`,
artifact download, and `.sig` consistency without executing the downloaded
AppImage.

## In-app upgrade smoke

The cheap preflight validates that an old updater-enabled release can see a
newer public `latest.json` and that both old/new AppImage signatures match the
release manifests:

```bash
pnpm run release:updater:upgrade-smoke:eligibility
```

The real GUI smoke requires a Linux x86_64 desktop/X11 environment because it
launches the old AppImage, clicks the application's update dialog, waits for the
AppImage to be replaced by the latest release artifact, then runs the hidden
package conversion smoke on the updated file:

```bash
pnpm run release:updater:upgrade-smoke -- --from-tag=v0.1.0 --to-tag=v0.1.1
```

On GitHub Actions, run the manual workflow `Updater Upgrade Smoke`. It installs `Xvfb` and `xdotool`, then executes the same
script on an Ubuntu x86_64 runner.

Because already-published old releases cannot receive new test hooks, the
`v0.1.0 -> v0.1.1` smoke uses UI clicks. Future old versions that already
contain this script and workflow can reuse the same upgrade smoke without
changing the old binary.

## GitHub Actions

Run the manual workflow `Updater Release` with:

- `tag`: the release tag, for example `v0.2.0`
- `publish_release=false`: build and upload workflow artifacts only
- `publish_release=true`: upload `latest.json`, AppImage, signature, and
  checksums to the GitHub Release

The workflow uses the same static endpoint:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

Before uploading assets, the workflow executes the signed AppImage with
`IMGCONVERT_PACKAGE_CONVERT_SMOKE=1`, so the published updater artifact has
already passed the same hidden conversion smoke used by Linux package tests.
The signing build job has read-only repository access and does not persist its
checkout credential. A separate job downloads the already-built artifact and
receives the narrowly scoped `contents: write` permission only while creating
the GitHub Release. Before that job can publish, it verifies the build-time
checksums, checks that `latest.json` names the exact signed Linux AppImage for
this repository and tag, re-verifies that staged updater artifact with the
configured public key, and generates the merged checksum manifest over the
staged release assets.

## Store channels

Tauri updater is intentionally disabled for Mac App Store and Microsoft Store
builds:

- MAS builds set `IMGCONVERT_DISABLE_UPDATER=1`, compile out updater plugin
  registration, limit capabilities to `default`, and hide the in-app update
  button. App Store updates are delivered by Apple.
- MSIX builds do the same through the generated Store Tauri config.
  Microsoft Store updates are delivered by Microsoft.

Direct macOS and Windows builds may use Tauri updater when those channels are
released, but store builds must never enable it.

Flatpak updates remain managed by Flathub once that channel is opened. `.deb`
and `.rpm` updates remain manual GitHub Release downloads in the first batch;
the Tauri updater is for direct-distribution artifacts such as AppImage, macOS
`.app.tar.gz`, and Windows installers.

## GPUI internal channel (S8)

The production endpoint is unchanged. `latest.json` is permanently limited to
0.3.x bridge releases; both the legacy generator and verifier reject 0.4.x and
later. A bridge build can opt into `latest-v2.json` using the existing
`TAURI_UPDATER_ENDPOINTS` release-config overlay. Shipping that build, changing
hosted metadata, signing with a production key, and publishing remain separate
release actions.

The new internal manifest includes an explicit per-platform `format` and an
OS-keyed `minimum_system_version` map, for example:

```json
{
  "version": "0.4.1",
  "minimum_system_version": { "linux": "5.4", "macos": "12", "windows": "10.0.18362" },
  "platforms": {
    "linux-aarch64": {
      "format": "appimage",
      "url": "https://example.invalid/ImgConvert.AppImage",
      "signature": "TAURI_BASE64_SIGNATURE"
    }
  }
}
```

`node scripts/gpui-updater-manifest.mjs INPUT OUTPUT/latest-v2.json` creates a
new file and refuses to overwrite an existing file. It validates formats,
minimum versions and credential-free HTTPS URLs. macOS entries include both
`darwin-*` (Tauri) and `macos-*` (cargo-packager) aliases, with conflicts rejected;
package signatures are checked
by the consumer, not by this generator. Minima cannot lower macOS 12 or Windows
10 build 18362. Linux compares the numeric kernel version and independently
requires a hardware Vulkan 1.3 device; CPU/software devices do not qualify.
Unknown host versions and missing metadata fail closed. The Tauri bridge checks
these rules before offering an update and again before downloading it. Legacy
0.3.x updates remain usable on older machines.

The GPUI shell's optional `updater` feature currently enables direct **Linux
AppImage only**. Builds without that feature omit the update entry point. The
build-time `IMGCONVERT_DISABLE_UPDATER=1` flag also hides it. Store, Snap and
Flatpak packaging must build with `--no-default-features`; they retain their
own update channel. macOS and Windows preview builds currently show manual
update guidance until their later packaging slices are verified.

Automatic AppImage updating requires both compile-time
`IMGCONVERT_UPDATER_ENDPOINT` (HTTPS, ending in `/latest-v2.json`) and
`IMGCONVERT_UPDATER_PUBKEY` (the existing Tauri public-key encoding), plus the
AppImage runtime's `APPIMAGE`/`APPDIR`. No endpoint or key is implicit. Opening
the dialog does not start a network request. Check, download and install are
explicit actions; state survives closing and reopening the dialog. Downloads
are bounded to 512 MiB and verified before the Install button appears. The
signed payload must be a raw type-2 AppImage for the running architecture.
Installation flushes settings, refuses an active conversion batch, syncs a
sibling temporary file and atomically replaces the AppImage. It does not quit
automatically; users reopen the application after installation. A failed
download or installation can be retried.

### Internal Linux SDK compatibility evidence

Run `node scripts/smoke-gpui-updater-compat.mjs` on native Linux x86_64/aarch64
with cargo-packager 0.11.8 and the repository's Tauri build dependencies. Or
manually dispatch `GPUI Probe` with `updater_compatibility=true`; it runs both
architectures and uploads JSON reports as internal CI artifacts.

This harness builds real cargo-packager AppImages containing a small executable,
generates an ephemeral Tauri signing key, serves a loopback-only manifest and
runs the actual Tauri updater 2.10.1 and cargo-packager-updater 0.2.3 against the
same signed artifact. It compares installed bytes and runs each installed
AppImage. Private test keys are deleted and never uploaded; production endpoints,
keys, settings and result caches are not used. The committed small signed ELF
fixtures separately test bounded downloads, signature rejection and atomic
installation in the application service.

SDK compatibility reports exclude the real desktop GUI, GPU eligibility,
settings migration and released installers. They are evidence for the Linux
package/signing rows of migration §3.6, not complete G3 or release acceptance.
Windows NSIS/MSI interoperability remains a G4 requirement; macOS has no shipped
automatic update channel. Final distributed artifacts must be reverified at G5.
