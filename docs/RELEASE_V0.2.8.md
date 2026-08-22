<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.8 Linux distribution release checklist

`v0.2.8` supersedes `v0.2.7` for the selected Snap Store, AppImageHub, and AUR
channels.

## Repository gates

1. All tag-verified version fields, Snap metadata, and AppImageHub AppStream
   metadata must be `0.2.8`.
2. Linux package builds and CI package smoke must run on Ubuntu 22.04; every
   bundled AppImage ELF must require no newer than `GLIBC_2.35`.
3. `AppRun`, `AppRun.wrapped`, and `usr/bin/imgconvert` inside the AppImage must
   be world-readable and executable so sandboxed catalog runners can launch it.
4. The canonical catalog asset must be named
   `ImgConvert-0.2.8-x86_64.AppImage` and coexist with the signed updater asset.
5. `imgconvert-bin` must contain no AppImage binary, no `SKIP` checksum, and a
   `.SRCINFO` identical to `makepkg --printsrcinfo`.
6. The downloadable updater artifact must retain the AUR package's hidden
   `.SRCINFO` file.
7. Snap must remain `core24`, strict, updater-disabled, external-codec-disabled,
   and limited to the GNOME extension plus `home` and optional
   `removable-media` access.
8. Snapcraft must use a custom lifecycle, clear the GNOME SDK library path
   before running Rustup, compile with the pinned Rust 1.96.0 toolchain, and
   enable Tauri's production custom protocol so the embedded frontend loads.
9. General CI and Linux release workflows must not run or publish unrelated
   Flatpak work. Its existing `0.2.3` metadata remains outside this release.

## External publication order

1. Build the complete draft GitHub Release and review every artifact.
2. Publish the GitHub Release and verify the canonical AppImage URL.
3. Re-run AppImageHub PR validation against the public v0.2.8 asset.
4. Push the four generated text files for AUR `imgconvert-bin`.
5. Reserve `imgconvert`, add package-scoped `SNAP_STORE_LOGIN`, publish both
   Snap architectures to `edge`, smoke them, and only then promote channels.
