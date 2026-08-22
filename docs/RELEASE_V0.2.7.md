<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.7 Linux distribution release checklist

`v0.2.7` supersedes the immutable, unpublished `v0.2.6` tag. It targets only
Snap Store, AppImageHub, and AUR.

## Repository gates

1. All tag-verified version fields, Snap metadata, and AppImageHub AppStream
   metadata must be `0.2.7`.
2. Linux package builds and CI package smoke must run on Ubuntu 22.04; every
   bundled AppImage ELF must require no newer than `GLIBC_2.35`.
3. The canonical catalog asset must be named
   `ImgConvert-0.2.7-x86_64.AppImage` and coexist with the signed updater asset.
4. `imgconvert-bin` must contain no AppImage binary, no `SKIP` checksum, and a
   `.SRCINFO` identical to `makepkg --printsrcinfo`.
5. The downloadable updater artifact must retain the AUR package's hidden
   `.SRCINFO` file.
6. Snap must remain `core24`, strict, updater-disabled, external-codec-disabled,
   and limited to the GNOME extension plus `home` and optional
   `removable-media` access.
7. Snapcraft must use a custom lifecycle, clear the GNOME SDK library path
   before running Rustup, compile with the pinned Rust 1.96.0 toolchain, and
   enable Tauri's production custom protocol so the embedded frontend loads.
8. General CI and Linux release workflows must not run or publish unrelated
   Flatpak work. Its existing `0.2.3` metadata remains outside this release.

## External publication order

1. Build the complete draft GitHub Release and review every artifact.
2. Publish the GitHub Release and verify the canonical AppImage URL.
3. Submit `packaging/appimagehub/ImgConvert` as `data/ImgConvert` upstream.
4. Push the four generated text files for AUR `imgconvert-bin`.
5. Reserve `imgconvert`, add package-scoped `SNAP_STORE_LOGIN`, publish both
   Snap architectures to `edge`, smoke them, and only then promote channels.
