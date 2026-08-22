<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.5 Linux distribution release checklist

`v0.2.5` supersedes the immutable, unpublished `v0.2.4` tag. It targets only
Snap Store, AppImageHub, and AUR.

## Repository gates

1. All tag-verified version fields, Snap metadata, and AppImageHub AppStream
   metadata must be `0.2.5`.
2. Linux package builds and CI package smoke must run on Ubuntu 22.04; every
   bundled AppImage ELF must require no newer than `GLIBC_2.35`.
3. The canonical catalog asset must be named
   `ImgConvert-0.2.5-x86_64.AppImage` and coexist with the signed updater asset.
4. `imgconvert-bin` must contain no AppImage binary, no `SKIP` checksum, and a
   `.SRCINFO` identical to `makepkg --printsrcinfo`.
5. Snap must remain `core24`, strict, updater-disabled, external-codec-disabled,
   and limited to the GNOME extension plus `home` and optional
   `removable-media` access.
6. Snapcraft's Rust plugin must use the pinned Rust channel and receive Rustup
   from the official `rustup/latest/stable` build snap on both architectures.
7. General CI and Linux release workflows must not run or publish unrelated
   Flatpak work. Its existing `0.2.3` metadata remains outside this release.

## External publication order

1. Build the complete draft GitHub Release and review every artifact.
2. Publish the GitHub Release and verify the canonical AppImage URL.
3. Submit `packaging/appimagehub/ImgConvert` as `data/ImgConvert` upstream.
4. Generate and push the four text files for AUR `imgconvert-bin`.
5. Reserve `imgconvert`, add package-scoped `SNAP_STORE_LOGIN`, publish both
   Snap architectures to `edge`, smoke them, and only then promote channels.
