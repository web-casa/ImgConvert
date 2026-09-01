<!-- SPDX-License-Identifier: Apache-2.0 -->

# Fuzzing

This directory contains `cargo-fuzz` targets for `imgconvert-core`. The two
filesystem/application-boundary targets live under `src-tauri/fuzz/` so their
GTK/WebKit build dependencies stay explicit.

Use:

```bash
pnpm run fuzz:prepare
pnpm run fuzz:check
pnpm run fuzz:replay
cargo fuzz run decode_pipeline
cargo fuzz run convert_pipeline
cargo fuzz run metadata_semantics
cargo fuzz run --fuzz-dir src-tauri/fuzz external_codec_manifest
cargo fuzz run --fuzz-dir src-tauri/fuzz import_scanner
cargo fuzz run --fuzz-dir src-tauri/fuzz pdf_document
```

`fuzz/corpus/` is local-only and intentionally ignored. Do not commit third-party
or private camera images into this repository; put them under `corpus/real/` or
point `IMGCONVERT_REAL_CORPUS_DIRS` at local directories, then run
`pnpm run fuzz:prepare`.

`pnpm run fuzz:replay` replays prepared seeds and `fuzz/artifacts/<target>/`
crash inputs through normal `imgconvert-core` paths and writes
`target/fuzz-corpus/replay-report.json`.
