<!-- SPDX-License-Identifier: Apache-2.0 -->

# Snap Store packaging

ImgConvert is packaged as a strict `core24` desktop snap. The GNOME extension
provides the GTK/WebKit runtime. `home` grants access to non-hidden files under
the user's home directory; `removable-media` is optional and may require a
manual connection. The snap does not request classic confinement, network,
background-service, or system-control interfaces.

The Store build uses Snapcraft's custom lifecycle with Rustup pinned to Rust
1.96.0. The custom lifecycle clears the GNOME SDK library path before invoking
host-linked build tools and enables Tauri's production custom protocol so the
embedded frontend is loaded instead of the development URL. It compiles out
both the Tauri updater and host external-codec discovery. Snap Store refreshes
deliver application updates.

Build and validate from a clean checkout:

```bash
snapcraft pack
pnpm run release:snap:verify -- --artifact=imgconvert_0.2.7_amd64.snap
sudo snap install --dangerous ./imgconvert_0.2.7_amd64.snap
```

Publishing is intentionally manual. Reserve `imgconvert` in the Snap Store,
export a package-scoped login, and save its complete content as the repository
secret `SNAP_STORE_LOGIN`:

```bash
snapcraft export-login \
  --snaps=imgconvert \
  --acls=package_access,package_push,package_update,package_release \
  --channels=edge,candidate,stable \
  snap-store-login.txt
```

Run the `Snap Store Release` workflow with an immutable tag. Keep
`publish_snap=false` for a build-only smoke run. Publish to `edge` first; move
to `candidate` or `stable` only after the installed snap passes the conversion
smoke test.
