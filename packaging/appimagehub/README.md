<!-- SPDX-License-Identifier: Apache-2.0 -->

# AppImageHub submission

AppImageHub is a catalog, not a binary host. ImgConvert continues to host the
AppImage on GitHub Releases. The `ImgConvert` file in this directory is the
one-line catalog entry to add as `data/ImgConvert` in
`AppImage/appimage.github.io` after the corresponding public release exists.

The catalog-facing artifact must be named
`ImgConvert-<version>-x86_64.AppImage`, include the AppStream file in
`usr/share/metainfo`, launch under X11 without a network connection, and use no
newer than the Ubuntu 22.04 `GLIBC_2.35` baseline. Prepare the canonical asset
after the updater AppImage has been built and signed:

```bash
pnpm run release:appimagehub:prepare
pnpm run release:linux:smoke:appimagehub
```

Do not submit the catalog entry until the canonical AppImage URL is public and
the upstream AppImageHub action passes.
