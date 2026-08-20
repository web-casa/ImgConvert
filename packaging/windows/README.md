<!-- SPDX-License-Identifier: Apache-2.0 -->

# Windows Packaging

This directory documents the first Windows release surface.

- Direct distribution uses Tauri's automatic `src-tauri/tauri.windows.conf.json` merge on Windows.
- The direct installer guardrails are intentionally explicit: no downgrade installs, SHA-256 signing digest, a silent embedded WebView2 bootstrapper, a minimum WebView2 runtime version, a pinned WiX `upgradeCode`, and a current-user NSIS default install.
- WiX builds separate `en-US` and `zh-CN` MSI packages. NSIS builds one installer containing English and Simplified Chinese and follows the Windows display language because its language selector is disabled.
- The repository does not store signing certificates, certificate thumbprints, Partner Center credentials, or timestamping secrets. Configure those only in the Windows release runner or signing environment.

Local preflight from any host:

```bash
pnpm run release:windows:direct:check
pnpm run release:windows:check
pnpm run release:windows:smoke -- --allow-non-windows --skip-convert-smoke
```

Runtime smoke on Windows:

```powershell
pnpm run release:windows:smoke
```

Direct distribution build on Windows:

```powershell
pnpm run release:windows
```

GitHub Actions exposes the manual-only `Windows Smoke` workflow. This keeps
runner cost predictable: the default run performs Windows guardrails, Rust
backend checks, and a hidden real conversion smoke. Manual runs can enable
`build_direct` to build `.msi` and NSIS `.exe` artifacts. Add `install_smoke`
to install each generated installer and run the hidden package smoke from the
installed `ImgConvert.exe`.

Signed direct distribution:

```powershell
$env:WINDOWS_CERTIFICATE_BASE64 = "<base64 pfx>"
$env:WINDOWS_CERTIFICATE_PASSWORD = "<pfx password>"
$env:WINDOWS_TIMESTAMP_URL = "http://timestamp.digicert.com"
pnpm run release:windows
pnpm run release:windows:sign
pnpm run release:windows:install-smoke
```

`release:windows:sign` also accepts `WINDOWS_CERTIFICATE_PATH` or
`WINDOWS_CERTIFICATE_SHA1`. The script signs with SHA-256 and RFC3161 timestamp
metadata, then verifies Authenticode with `signtool verify /pa /all`.

Microsoft Store is a separate candidate path. Tauri does not make MSIX a
first-class bundle target for this repo, so the store route uses an explicit
MSIX manifest template with `runFullTrust`. The Partner Center package identity
is committed as the default in `scripts/prepare-windows-msix-release.mjs`
(identity name `53660AlanM.ImgConvert`, publisher
`CN=84AC3716-04E0-4D67-8951-0D3E51674CA0`, publisher display name `AlanM.`,
Store ID `9P1BWD965DBX`); set the `WINDOWS_STORE_*` environment variables only
to override those values.

Store candidate preflight must compile with external codec/helper discovery and
Tauri updater disabled. Microsoft Store delivers updates, so the store package
must not contain or expose the Tauri updater.
`WINDOWS_STORE_VERSION` must follow Store rules: a nonzero major component and
a zero fourth component (`1.0.0.0`, not the app version `0.1.2`):

```powershell
$env:IMGCONVERT_DISABLE_EXTERNAL_CODECS = "1"
$env:IMGCONVERT_DISABLE_UPDATER = "1"
$env:WINDOWS_STORE_VERSION = "1.0.0.0"
pnpm run release:windows:store:check
pnpm run release:windows:msix:prepare
```

Actual Store submission packaging runs on Windows with the Windows 10/11 SDK
(`makeappx.exe`/`signtool.exe`) installed. Build the bundle-free binary, stage
the layout, and pack the MSIX in one step:

```powershell
$env:IMGCONVERT_DISABLE_EXTERNAL_CODECS = "1"
$env:IMGCONVERT_DISABLE_UPDATER = "1"
$env:WINDOWS_STORE_VERSION = "1.0.0.0"
pnpm run release:windows:msix
```

`release:windows:msix` prepares the Store manifest and a Store Tauri
config, runs `tauri build --ci --no-bundle`, validates the Store assets in `src-tauri/icons`, stages
`src-tauri/target/windows-msix/layout`, and packs
`ImgConvert_<version>_x64.msix` with `makeappx.exe`. Use
`release:windows:msix:pack` to repack an already-built binary.

Sideload install smoke first copies the MSIX into a temporary directory, then
signs that copy with a temporary self-signed certificate matching the manifest
publisher, trusts it, installs the copy, and runs the hidden conversion smoke
from the installed `ImgConvert.exe`. The original submission artifact remains
unchanged. It requires an elevated shell:

```powershell
pnpm run release:windows:msix:smoke
```

GitHub Actions provides a dedicated `Windows Store MSIX` production build
workflow. Its required `release_tag` checks out and verifies the immutable app
release tag before it uses the committed Partner Center identity defaults,
builds the submission `.msix` with external codecs and Tauri updater disabled,
runs the sideload smoke against a temporary copy, then uploads the untouched
`imgconvert-windows-x64-msix-submission` artifact. It never attaches MSIX to a
GitHub Release or creates a Partner Center submission.

For a real hosted-runner install smoke, manually dispatch `Windows Smoke` with
`store_msix=true`. That path uses the isolated `ImgConvert.DevSmoke` identity,
keeps `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` and
`IMGCONVERT_DISABLE_UPDATER=1`, builds the MSIX, then runs
`release:windows:msix:smoke`. After the signed temporary copy passes its
install/conversion smoke, the workflow uploads a three-day
`imgconvert-windows-x64-msix-devsmoke` artifact containing that signed MSIX,
its seven-day public `.cer`, SHA-256 checksums, and installation instructions.
The export is restricted to the isolated DevSmoke package identity. The PFX and
private key remain temporary and are never uploaded. This development artifact
does not create a Partner Center submission and is not a production release.

The Microsoft Store signs accepted submissions with its own trusted
certificate, so no purchased code-signing certificate is needed for the Store
channel. Store submission still requires Store listing assets, age
rating/privacy metadata, and a real install smoke on the submitted package
(`release:windows:msix:smoke` covers the sideload path). The main package must
keep `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` and
`IMGCONVERT_DISABLE_UPDATER=1`; optional HEIC helpers must not be bundled into
the Store package unless channel rules are revalidated. `runFullTrust` is a
restricted capability; the account owner must provide its factual use case in
Partner Center Submission options before certification, as recorded in
`docs/STORE_LISTING_4A.md`.

For v0.2.1, `release_tag=v0.2.1` identifies the shared source snapshot, while
`store_version` must be chosen by the Partner Center account owner to be newer
than any package version already associated with this Store identity. The
four-part Store version is not inferred from app semver. The full release order
and GitHub-DMG/Store-MSIX channel boundary are in
[`docs/RELEASE_V0.2.1.md`](../../docs/RELEASE_V0.2.1.md).

Windows HEIC remains decode-only by product policy. The system route uses WIC
runtime detection of the Microsoft HEIF Image Extensions and HEVC Video
Extensions. When those are present, capabilities expose a read-only
`system-wic` provider for `heic`/`heif`/`hif`. When missing, plugin diagnostics
show a clear install hint. The optional free HEIC helper remains a separately
distributed decode-only plugin and is not bundled into the main app.
