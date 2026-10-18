# ImgConvert clipboard fixes

Upstream: [1Password/arboard 3.7.0](https://crates.io/crates/arboard/3.7.0).
The crate source, copyright notices and complete MIT/Apache license texts are
preserved here. This is a narrowly patched dependency, not ImgConvert-owned code.
Both Rust workspaces patch the same crate; Tauri does not enable the optional
platform clipboard feature.

Changes:

- An empty standalone workspace table keeps dependency regression tests outside
  ImgConvert's three-member root workspace. Its standalone test lockfile pins the
  tested dev-dependency graph; consumers use their own workspace lockfiles.

- Linux URI lists retain percent-decoded native filename bytes. Upstream silently
  filters invalid UTF-8 names; ImgConvert must receive them to report unsupported
  paths without substituting an image preview. Accept `file://localhost/` as local.
  Upstream 3.7.0 already strips the CRLF transport terminator before decoding, so
  encoded trailing CR bytes in a filename remain intact.
- Windows checks CF_HDROP availability while the clipboard is open. An advertised
  file list that fails to read now returns Unknown, rather than ContentNotAvailable,
  so the application does not substitute a preview image for unreadable files.

Validation:

- `cargo test --manifest-path vendor/arboard/Cargo.toml --locked --lib imgconvert_uri_regressions`
- `xvfb-run -a cargo test -p imgconvert-platform --features clipboard --lib native_clipboard_round_trips -- --ignored`
- macOS/Windows Smoke runs the same native file/image/text round trip. Kit tests
  cover invalid paths, source ownership and final-commit cancellation separately.

Keep these changes narrow. Recheck upstream before upgrading, and remove the
patches when equivalent fixes ship there. No GPL/AGPL/LGPL code was used.
