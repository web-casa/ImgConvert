<!-- SPDX-License-Identifier: Apache-2.0 -->

# v0.2.3 Linux distribution release checklist

> Superseded by v0.2.4. The immutable v0.2.3 tag exposed Ubuntu 22.04
> compatibility-check failures before any public release or Store publication.

`v0.2.3` adds the three selected Linux distribution channels only: Snap Store,
AppImageHub, and AUR. Existing Flatpak files remain in the repository for
compatibility checks but are not a publication target for this release.

## Repository gates

1. All five tag-verified version fields, Snap metadata, and AppStream metadata
   must be `0.2.3`.
2. The AppImage must be built on Ubuntu 22.04 and every bundled ELF must require
   no newer than `GLIBC_2.35`.
3. The canonical catalog asset must be named
   `ImgConvert-0.2.3-x86_64.AppImage` and coexist with the signed updater asset.
4. `imgconvert-bin` must contain no AppImage binary, no `SKIP` checksum, and a
   `.SRCINFO` identical to `makepkg --printsrcinfo`.
5. Snap must remain `core24`, strict, updater-disabled, external-codec-disabled,
   and limited to the GNOME extension plus `home` and optional
   `removable-media` access.

## External publication order

1. Publish the complete public GitHub Release and verify the canonical AppImage
   URL.
2. Submit `packaging/appimagehub/ImgConvert` as `data/ImgConvert` upstream and
   wait for its automated review.
3. Generate the release-specific `target/aur/imgconvert-bin` directory, copy
   its four text files to the AUR `imgconvert-bin` Git repository, and push.
4. Reserve `imgconvert` in the Snap Store, add package-scoped
   `SNAP_STORE_LOGIN`, publish both architectures to `edge`, smoke them, and
   only then promote to `candidate` or `stable`.
