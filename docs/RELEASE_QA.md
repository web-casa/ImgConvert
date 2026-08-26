<!-- SPDX-License-Identifier: Apache-2.0 -->

# Cross-platform release acceptance

This is the required acceptance record for a tagged ImgConvert release. CI
proves that each supported architecture can build and that packaged artifacts
have the expected binary shape; it does not replace a real installation or an
App Store review device pass.

## Native build matrix

| Surface | Architecture | Hosted runner | Required evidence |
| --- | --- | --- | --- |
| Windows direct/MSIX | x64 | `windows-latest` | PE machine check, MSI/NSIS or MSIX install smoke |
| Windows direct/MSIX | arm64 | `windows-11-arm` | PE machine check, MSI/NSIS or MSIX install smoke |
| macOS direct DMG | arm64 | `macos-15` | Mach-O, `otool`, signing/notarization checks |
| macOS direct DMG | x86_64 | `macos-15-intel` | Mach-O, `otool`, signing/notarization checks |
| Mac App Store | universal (`arm64` + `x86_64`) | `macos-15` | `lipo` two-slice check, sandbox/profile/package validation |
| Linux packages | amd64 | `ubuntu-22.04` | ELF/GLIBC/`ldd`, install/runtime smoke |
| Linux packages | arm64 | `ubuntu-22.04-arm` | ELF/GLIBC/`ldd`, install/runtime smoke |

The Linux baseline deliberately remains Ubuntu 22.04 rather than moving the
arm64 release build to 24.04: AppImageHub compatibility requires
`GLIBC_2.35` or lower for every bundled ELF.

## Automated gates

Before publishing a tag, run the repository checks and the relevant manual
workflows from the immutable tag:

```bash
pnpm run release:platform:check
pnpm run format:check
pnpm run typecheck
pnpm run lint
pnpm run test:image-quality
```

The release workflows additionally enforce these checks:

- macOS: `file`, `lipo -archs`, `otool -L`, deep code-sign verification,
  Developer ID or MAS signing authority, notarization/Gatekeeper where
  applicable, and no linked `libheif`/`libx265`.
- Windows: PE machine type before packaging, MSIX manifest/package executable
  agreement, `makeappx pack` followed by `makeappx unpack` package inspection,
  Authenticode verification for signed installers, and installed-binary
  architecture checks.
- Linux: ELF architecture and dynamic-library checks for every packaged ELF,
  GLIBC baseline, metadata checks, and Docker package smokes on Ubuntu 24.04,
  Debian 13, Fedora 42, and the Ubuntu 22.04 AppImageHub baseline.

The direct-channel updater remains intentionally separate from Store builds.
MAS and Microsoft Store builds compile with the updater disabled and receive
updates from their stores. Run a real direct-channel updater transition only
when two released updater artifacts exist:

```bash
pnpm run release:updater:upgrade-smoke -- \
  --from-tag=v<previous> --to-tag=v<current> --platform=linux-x86_64
```

After a tag-triggered `Linux Release` matrix succeeds, use the manual `Linux
Release Assets Finalize` workflow from `main` to attach its verified amd64 and
arm64 direct packages to the existing same-tag GitHub Release. The finalizer
checks the source run provenance, immutable tag commit, both per-architecture
checksum manifests, and the current release checksum manifest before it
publishes assets. It then replaces only the release-level `SHA256SUMS` with a
merged manifest and verifies the public download set again.

## Image corpus and resource acceptance

Record the machine, OS version, package type, and result for each supported
platform before publishing.

| Case | Expected result |
| --- | --- |
| CMYK JPEG | Imports and converts without a crash or inverted/empty output. |
| PNG with transparency | Alpha survives PNG/WebP/AVIF lossless conversions; JPEG is flattened deliberately. |
| Animated WebP | Clear rejection; no frame-zero-only output is written. |
| Still HEIC/HEIF | Imports only where the platform provider is available; verify both macOS architectures through ImageIO. |
| Multi-frame HEIC/HEIF through macOS ImageIO or Windows WIC | Clear rejection; no frame-zero-only output is written. External Linux helpers remain a separately audited, decode-only integration. |
| Large 8,000 × 8,000 image | Converts on a representative machine without runaway batch parallelism. |
| 10,000 × 10,000 image | Is rejected before pixel allocation. The 64 MP ceiling is intentional and prevents a single image from exhausting the 768 MiB batch working-set budget. |
| Corrupt/truncated image | Fails cleanly with no successful output file. |

CMYK JPEG, PNG transparency, animated WebP, and corrupt-input cases have
deterministic core regression coverage. The ImageIO/WIC HEIC paths also have
native platform tests and hosted HEIC smokes; the realistic large-image machine
pass remains manual because its purpose is to observe actual memory pressure
rather than consume every CI runner's memory.

## Installation lifecycle

For every direct package architecture, use a clean VM or a test user profile:

1. Install the current package and convert JPEG, PNG, WebP, and AVIF.
2. Install the current package over the prior released package of the same
   channel and verify that the new version launches and retains expected user
   settings.
3. Uninstall it and verify that the executable is gone. User-created output and
   user configuration should not be deleted silently.

Windows CI executes the clean-install, launch, conversion, architecture, and
uninstall portions for MSI and NSIS. A true upgrade needs a prior signed
installer, so it remains a deliberate release-manager VM step. The MSIX smoke
uses a disposable DevSmoke identity and removes the test package afterwards.

## Store and signing acceptance

- Direct macOS: verify each architecture's signed DMG after Apple accepts
  notarization; staple and assess it before attaching it to a GitHub Release.
- Mac App Store: upload the universal signed `.pkg`, wait for processing, then
  test the exact processed build from TestFlight on physical Intel and Apple
  Silicon Macs. Exercise file selection, output-directory selection, conversion,
  relaunch, then select the output directory again before converting under the
  sandbox. On a clean macOS test user, also exercise a selected folder in the
  Media Library privacy domain and verify that any resulting prompt shows the
  current `NSAppleMusicUsageDescription`; capture both Allow and Don't Allow
  behavior without requiring the rest of the app to stop working.
- Flatpak: use the portal file picker to select an input, then select an output
  folder before converting. Confirm no broad host filesystem permission is
  required, the output is created through the portal path, and the saved output
  folder remains usable after relaunch.
- Snap: test both a normal home-directory input and a portal-provided hidden or
  removable-media input. Select an output folder before conversion and confirm
  the conversion succeeds under strict confinement without requesting classic
  confinement.
- Microsoft Store: submit architecture-specific MSIX packages only after their
  sideload smoke succeeds; Store versions must use Store updates, not Tauri
  updater.
- App Review: capture a continuous physical-device screen recording from app
  launch through selecting a sample image, choosing an output format/folder,
  converting, and opening the result. Put the tested devices/OS versions,
  sample-file instructions, no-account/no-payment statement, local-only
  processing statement, external-service list, regional-consistency statement,
  and any relevant rights statement in App Store Connect review notes.

Do not mark this document's manual items complete based solely on a green CI
run. Attach the resulting workflow URLs, build numbers, and test notes to the
release issue or App Store Connect submission.
