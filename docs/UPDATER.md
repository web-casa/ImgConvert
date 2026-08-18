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

For the first public release batch, GitHub Releases is the only distribution
channel: Linux `.deb`, `.rpm`, AppImage, AppImage signature, checksums, and
`latest.json`. Flathub, MAS, MSIX, and other store channels remain deferred.

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

The default artifact base URL is:

```text
https://github.com/web-casa/ImgConvert/releases/download/v0.1.2
```

Override these when preparing a non-default repository or tag:

```bash
export TAURI_UPDATER_PUBKEY="$(cat ~/.tauri/imgconvert-updater.key.pub)"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/imgconvert-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
export TAURI_UPDATER_ENDPOINTS='["https://github.com/web-casa/ImgConvert/releases/latest/download/latest.json"]'

pnpm run release:linux:updater

export TAURI_UPDATER_ARTIFACT_BASE_URL="https://github.com/web-casa/ImgConvert/releases/download/v0.1.2"
pnpm run release:updater:manifest
pnpm run release:updater:verify
```

The Linux updater path scrubs the AppImage first, then re-signs the final
AppImage with `tauri signer sign`. This avoids publishing a signature for a
pre-scrub artifact. The verify step checks that `latest.json` points at the
final local artifact and that each manifest signature matches the adjacent
`.sig` file.

Upload these files to the GitHub Release:

- `target/updater/latest.json`
- `src-tauri/target/release/bundle/appimage/*.AppImage`
- `src-tauri/target/release/bundle/appimage/*.AppImage.sig`
- `src-tauri/target/release/bundle/SHA256SUMS`

Before uploading the first GitHub Releases batch, run the local read-only gate:

```bash
pnpm run release:readiness:github:ready
```

It fails if the Linux packages, checksums, AppImage updater signature,
`latest.json`, or updater prerequisites are still missing for the GitHub-only
release scope.

After the release is published, verify the public updater surface:

```bash
pnpm run release:updater:smoke -- --repo=web-casa/ImgConvert --tag=v0.1.2 --platform=linux-x86_64
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

- `tag`: the release tag, for example `v0.1.2`
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
