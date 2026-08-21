<div align="center">
  <img
    src="src-tauri/icons/128x128.png"
    width="96"
    height="96"
    alt="ImgConvert app icon"
  >
  <h1>ImgConvert</h1>
  <p><strong>A local-first, cross-platform batch image converter and compressor</strong></p>
  <p>Drag and drop · Batch processing · Metadata preservation · No image uploads by default</p>
  <p><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
  <p>
    <a href="https://github.com/web-casa/ImgConvert/releases/latest">
      <img
        alt="Latest release"
        src="https://img.shields.io/github/v/release/web-casa/ImgConvert?label=release"
      >
    </a>
    <a href="https://github.com/web-casa/ImgConvert/actions/workflows/ci.yml">
      <img
        alt="CI status"
        src="https://github.com/web-casa/ImgConvert/actions/workflows/ci.yml/badge.svg"
      >
    </a>
    <a href="LICENSE">
      <img
        alt="Apache-2.0 license"
        src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"
      >
    </a>
    <a href="https://tauri.app">
      <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri">
    </a>
    <a href="https://svelte.dev">
      <img
        alt="Svelte 5"
        src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white"
      >
    </a>
  </p>
  <p>
    <a href="https://github.com/web-casa/ImgConvert/releases/latest">
      <strong>Download the latest release</strong>
    </a>
    · <a href="docs/ROADMAP.md">Roadmap</a>
    · <a href="docs/ENGINE.md">Architecture</a>
    · <a href="PRIVACY.en.md">Privacy</a>
  </p>
</div>

<p align="center">
  <a href="docs/assets/screenshots/main-workspace.png">
    <img
      src="docs/assets/screenshots/main-workspace.png"
      width="100%"
      alt="ImgConvert batch conversion workspace"
    >
  </a>
</p>
<p align="center">
  <sub>Batch imports, per-file format overrides, compression settings, and progress in one workspace.</sub>
</p>

> [!NOTE]
> The current stable version is **v0.2.1**. GitHub Releases provides a notarized macOS
> arm64 DMG, Windows x64 EXE/MSI installers, and Linux packages for both architectures.
> Microsoft Store and Mac App Store distribution is still in preparation.

## Downloads

| Platform            | Package                                         | Status                         |
| ------------------- | ----------------------------------------------- | ------------------------------ |
| macOS arm64         | [DMG][latest-release]                           | Signed and notarized           |
| Windows x64         | [NSIS EXE, English/Chinese MSI][latest-release] | Published, currently unsigned  |
| Linux amd64 / arm64 | [AppImage, deb, rpm][latest-release]            | Published with checksums       |
| Microsoft Store     | MSIX                                            | Distributed via Partner Center |
| Mac App Store       | MAS package                                     | Pending validation and review  |

> [!WARNING]
> Windows EXE/MSI installers distributed through GitHub are not currently
> Authenticode-signed and may trigger Microsoft Defender SmartScreen. Verify them
> against `SHA256SUMS-windows.txt` in the release before installation.

## Interface preview

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/assets/screenshots/format-picker.png">
        <img
          src="docs/assets/screenshots/format-picker.png"
          width="100%"
          alt="Per-file output format picker"
        >
      </a>
    </td>
    <td width="50%" valign="top">
      <a href="docs/assets/screenshots/plugin-diagnostics.png">
        <img
          src="docs/assets/screenshots/plugin-diagnostics.png"
          width="100%"
          alt="HEIC provider and system codec diagnostics"
        >
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><sub>Override the output format for one file without affecting the rest of the queue.</sub></td>
    <td align="center"><sub>See the active HEIC provider, system capabilities, and licensing boundary.</sub></td>
  </tr>
</table>

## Core capabilities

| Capability          | Details                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Conversion          | In-process AVIF, WebP, JPEG, and PNG with true lossless AVIF support                                                |
| Batch workflow      | Files, folders, recursive and clipboard imports; deduplication, asynchronous thumbnails, progress, and cancellation |
| Performance         | Rust batch conversion, controlled concurrency, memory-aware throttling, and channel-based progress reporting        |
| Compression         | `skip-if-larger`, smallest-candidate selection, automatic quality, and generation-loss protection                   |
| Fidelity            | Physical EXIF orientation correction; preserve or strip ICC / EXIF / XMP / IPTC metadata                            |
| Color               | Display P3 ICC tests, explicit sRGB conversion, and color pipeline v2                                               |
| HEIC import         | macOS ImageIO, Windows WIC, Linux helper / Flatpak extension; import only                                           |
| Privacy             | Images stay on the local machine by default; no account or source-image upload required                             |
| Release engineering | Tauri updater, cross-platform packages, and licensing / fuzz / benchmark / CI guardrails                            |

## Release and project status

- ✅ **GitHub v0.2.1**: macOS DMG, Windows EXE/MSI, and Linux AppImage/deb/rpm
  packages are published with updater metadata, signatures, and checksums.
- ✅ **Direct macOS distribution**: Developer ID Application signing, notarization,
  stapling, and Gatekeeper verification have passed.
- ✅ **Core product**: the P0–P3 UI, Rust engine, batch processing, compression,
  metadata, color, fuzzing, and cross-platform packaging entrypoints are implemented.
- 🚧 **Real release validation**: the MAS build, sandbox, and signing checks pass;
  App Store Connect setup, upload, and App Review remain. Microsoft Store submission
  is handled by the authorized account owner.
- 🚧 **External validation**: Flathub review, direct Windows signing, long-running
  fuzzing with a real-image corpus, and Windows benchmark data are still in progress.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full plan, acceptance evidence, and
remaining work.

## Architecture and stack

| Layer         | Technology and boundary                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| Desktop shell | Tauri 2                                                                         |
| Frontend      | Svelte 5 runes, shadcn-svelte, Tailwind CSS v4, Phosphor Icons                  |
| Image core    | Rust, `mozjpeg`, `oxipng`, `webp`, `libavif-sys`, `image`                       |
| HEIC          | No bundled HEIC codec; system provider or optional helper depending on platform |
| Toolchain     | pnpm, Node LTS, Rust toolchain, CMake, Meson, Ninja, NASM                       |

The image engine combines permissively licensed in-process Rust codecs with platform
HEIC providers. The main application neither distributes x265 nor exports HEIC. See
[docs/ENGINE.md](docs/ENGINE.md) and [docs/LEGAL.md](docs/LEGAL.md) for the design and
licensing boundaries.

## Quick start

Install [Rust](https://rustup.rs/), Node LTS, [pnpm](https://pnpm.io/), and the Tauri
system dependencies for your platform. Native image dependencies also require CMake,
Meson, Ninja, and NASM.

```bash
pnpm install
pnpm run tauri dev
```

Common checks and build commands:

```bash
pnpm run check
pnpm run build
pnpm run tauri build
pnpm run docs:web:dev

pnpm run release:readiness
pnpm run release:readiness:github:ready
pnpm run release:readiness:all
pnpm run release:platform:check
```

> [!TIP]
> If Linux reports a missing `dbus-1.pc`, install `libdbus-1-dev` / `dbus-devel`
> and `pkg-config`. See [docs/ENGINE.md](docs/ENGINE.md) for the complete platform
> toolchain requirements.

## Documentation

- [ROADMAP](docs/ROADMAP.md): roadmap, version status, priorities, and release readiness reports
- [ENGINE](docs/ENGINE.md): image core, system HEIC integration, toolchain, packaging, and signing
- [LEGAL](docs/LEGAL.md): Apache-2.0, dependency licensing rules, HEVC patents, and distribution boundaries
- [REFERENCES](docs/REFERENCES.md): reference-project research and reusable design decisions
- [PRIVACY](PRIVACY.en.md) / [简体中文](PRIVACY.md): privacy policies in English and Chinese
- [CONTRIBUTING](CONTRIBUTING.md): contribution workflow, DCO, and development conventions

## License

ImgConvert is released under [Apache-2.0](LICENSE), allowing commercial use and app
store distribution. See [docs/LEGAL.md](docs/LEGAL.md) for dependency licensing rules,
the third-party component inventory, and HEVC risk notes.

[latest-release]: https://github.com/web-casa/ImgConvert/releases/latest
