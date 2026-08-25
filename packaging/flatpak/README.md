<!-- SPDX-License-Identifier: Apache-2.0 -->

# Flatpak Packaging

This directory contains the ImgConvert Flatpak packaging surface:

- `io.github.yeagoo.imgconvert.yml` builds from a generated release archive instead of the repository root.
- `pnpm run release:flatpak:prepare` creates that release archive with vendored Corepack/pnpm (`.flatpak-vendor/corepack.tgz`) plus vendored Cargo/npm inputs under `target/flatpak/sources/`, then updates the manifest `sha256`.
- `finish-args` intentionally avoid broad host filesystem access so file access continues to go through user-selected portal paths. Flatpak uses Tauri's GTK `GtkFileChooserNative` dialog (the portal-aware path), never the AppImage-only host `zenity`/`kdialog` workaround.
- Select an output folder before the first conversion. A portal-selected individual input file does not authorize creating a sibling output; the selected output folder grants writable document-portal access and is retained by the portal across app launches.
- The manifest tracks the supported GNOME `50` runtime; do not leave Flathub packaging pinned to EOL GNOME branches.
- AppStream metadata uses `metadata_license=CC0-1.0`; the application/project license remains `Apache-2.0`.
- `IMGCONVERT_DISABLE_EXTERNAL_CODECS=1` is set for the Flatpak main package so host PATH/XDG helpers stay disabled inside the sandbox.
- `IMGCONVERT_ALLOW_FLATPAK_CODEC_EXTENSIONS=1` allows only the application-owned extension point `io.github.yeagoo.imgconvert.Codecs` mounted at `/app/extensions/codecs`.
- Optional HEIC support uses the addon under `extensions/heic/` (`io.github.yeagoo.imgconvert.Codecs.Heic`) and must be built as a separate decode-only LGPL extension, not bundled into the Apache-2.0 main package.

Local build/smoke on a host with Flatpak tooling:

```bash
pnpm run release:flatpak:smoke
```

The smoke command prepares the generated source archive, verifies the manifest, builds with `flatpak-builder`, runs the hidden conversion smoke inside the build sandbox, installs the app into the user Flatpak installation, then runs the same conversion smoke through `flatpak run`. It adds the Flathub user remote when missing so the GNOME runtime and SDK extensions can be resolved.

If you need to spell the sequence out while debugging:

```bash
pnpm run release:flatpak:prepare
pnpm run release:flatpak:verify
flatpak-builder --user --assumeyes --install-deps-from=flathub --install --force-clean target/flatpak/build-dir packaging/flatpak/io.github.yeagoo.imgconvert.yml
flatpak run --user --command=imgconvert --env=IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 --env=IMGCONVERT_PACKAGE_CONVERT_SMOKE=1 io.github.yeagoo.imgconvert
```

For a Flathub PR, publish `target/flatpak/sources/imgconvert-<version>-source.tar.gz` to a release URL first, then rewrite the manifest source while keeping the generated `sha256`:

```bash
version="$(node -p 'require("./package.json").version')"
pnpm run release:flatpak:prepare -- --source-url="https://github.com/web-casa/ImgConvert/releases/download/v${version}/imgconvert-${version}-source.tar.gz"
pnpm run release:flatpak:verify
```

Flathub-specific metadata/linter checks and PR workspace generation:

```bash
version="$(node -p 'require("./package.json").version')"
pnpm run release:flathub:metadata
pnpm run release:flathub:metadata:lint
pnpm run release:flathub:main-pr -- --source-url="https://github.com/web-casa/ImgConvert/releases/download/v${version}/imgconvert-${version}-source.tar.gz" --release-ref="v${version}"
```

`release:flathub:metadata:lint` runs `flatpak-builder-lint` only when
`org.flatpak.Builder` is installed. The generated PR workspace lands under
`target/flathub/main/`; copy the top-level `io.github.yeagoo.imgconvert.yml` into a
branch based on `flathub/flathub:new-pr`.

The Flatpak app-id intentionally uses the GitHub namespace
`io.github.yeagoo.imgconvert` so Flathub's official linter can verify a reachable
upstream identity. The Tauri/macOS bundle identifier remains
`com.ivmm.imgconvert`.

The AppStream screenshot URL must exist on the release tag or commit referenced
by `--release-ref`. Before that ref is pushed, `flatpak-builder-lint appstream`
will report `screenshot-image-not-found` even though the local screenshot asset
is present.

Do not add LGPL/GPL codec helpers to the main Flatpak manifest. HEIC helper support stays in a separate extension/helper package and still needs Flathub addon review before public use.

## Optional HEIC Extension

The main manifest defines this extension point:

```yaml
io.github.yeagoo.imgconvert.Codecs:
  version: "1"
  directory: extensions/codecs
  add-ld-path: lib
  subdirectories: true
```

A HEIC extension installs `imgconvert-codec-heic.json` plus a decode-only helper
under its extension root. The real manifest
`extensions/heic/io.github.yeagoo.imgconvert.Codecs.Heic.yml` builds `libde265` and
`libheif` from pinned upstream source tarballs, disables HEIC encoding and x265,
then wraps `heif-dec` as `bin/imgconvert-heic-helper`.

Static verification:

```bash
pnpm run release:flatpak:heic:verify
```

Source URL and checksum smoke, without requiring the main app runtime to be
installed:

```bash
pnpm run release:flatpak:heic:download-check
```

`flatpak-builder` may still print that `io.github.yeagoo.imgconvert` is not installed
in this mode; that is expected for `--allow-missing-runtimes`. Treat the command
exit code as the pass/fail signal.

Build smoke on a host with Flatpak tooling and the main app runtime available:

```bash
pnpm run release:flatpak:heic:smoke
```

Full sandbox smoke with the main package and HEIC extension installed from the
same temporary local Flatpak repo:

```bash
pnpm run release:flatpak:heic:real-smoke
```

If `IMGCONVERT_FLATPAK_HEIC_SMOKE_INPUT` or `--sample=/path/to/sample.heic` is
not provided, the script tries to generate a small HEIC fixture with host
`heif-enc` and then converts it through `flatpak run --command=imgconvert`.
This is the smoke to run before the HEIC addon review because it exercises the
extension mount path inside the sandbox instead of only building the addon.

Prepare the separate addon PR workspace:

```bash
version="$(node -p 'require("./package.json").version')"
pnpm run release:flathub:heic-pr -- --release-ref="v${version}"
```

The generated workspace lands under `target/flathub/heic-extension/`. The addon
must stay a separate LGPL decode-only submission and should be reviewed
separately from the Apache-2.0 main package.

The expected codec manifest keeps HEIC read-only:

```json
{
  "readable": ["heic", "heif", "hif"],
  "writable": [],
  "decode": {
    "kind": "heic-to-png-file",
    "args": ["{input}", "{output}", "{metadata}"]
  }
}
```

The extension installs upstream LGPL license texts under its own extension
license directory. Patent/channel review is still separate from repository
packaging. Do not claim built-in HEIC support from the main Flatpak package.
