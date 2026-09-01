<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fuzzing And Real Corpus

ImgConvert fuzzing is split into two layers:

- deterministic generated seeds committed as code, produced locally by
  `crates/imgconvert-core/examples/generate_fuzz_corpus.rs`;
- local real-world image corpus import, never committed to the repository.

## Quick Start

```bash
pnpm run fuzz:prepare
pnpm run fuzz:check
pnpm run fuzz:replay
```

`fuzz:prepare` writes generated core seeds to `fuzz/corpus/*`, Tauri seeds to
`src-tauri/fuzz/corpus/*`, and imports supported real images from
`corpus/real/`. The corpus directories are ignored on purpose. `fuzz:replay`
runs the prepared corpus through the normal core and Tauri fuzz bridges without
requiring `cargo-fuzz`.

To require at least one local real image:

```bash
pnpm run fuzz:prepare:require-real
```

To point at external local photo folders:

```bash
IMGCONVERT_REAL_CORPUS_DIRS="/path/to/camera-a:/path/to/camera-b" pnpm run fuzz:prepare
```

On Windows, separate directories with `;` instead of `:`.

## Targets

- `decode_pipeline`: format magic, header probe, thumbnail, lossy-artifact hint,
  and bounded decode.
- `convert_pipeline`: bounded real conversion into PNG/JPEG/WebP/AVIF with
  conservative fast options.
- `metadata_semantics`: EXIF/XMP/IPTC semantic inspection and normalization.
- `external_codec_manifest`: external helper manifest JSON parsing, license and
  argv/path validation.
- `import_scanner`: bounded synthetic directory trees, recursion/limit handling,
  symlink rejection, and image/PDF metadata probing.
- `pdf_document`: bounded Hayro document parsing and page-dimension validation.

## Corpus Replay

Use replay for cheap regression coverage after preparing corpus data:

```bash
pnpm run fuzz:replay
```

It writes `target/fuzz-corpus/replay-report.json` and returns non-zero if a
target panics or violates an invariant such as output magic mismatch. By default
it includes both `fuzz/artifacts/<target>/` and
`src-tauri/fuzz/artifacts/<target>/`, so minimized crash inputs become ordinary
regression cases after they are placed there. The report has separate `core`
and `tauri` suite totals and one target record for each of the six targets.

For CI-style local smoke:

```bash
pnpm run fuzz:smoke
```

That command prepares seeds, compiles the fuzz targets, and replays the corpus.

Long-running fuzzing requires `cargo-fuzz`:

```bash
cargo install cargo-fuzz
pnpm run fuzz:prepare
cargo fuzz run decode_pipeline
cargo fuzz run convert_pipeline
cargo fuzz run metadata_semantics
cd src-tauri
cargo fuzz run external_codec_manifest
cargo fuzz run import_scanner
cargo fuzz run pdf_document
```

## Corpus Rules

- Do not commit real photos or third-party fixtures.
- Keep private/copyrighted images only under ignored local corpus directories.
- The import script copies JPEG/PNG/WebP/AVIF/SVG/GIF/BMP files recognized by
  magic bytes. Animated GIF samples are expected to be cleanly rejected rather
  than converted as a first frame.
- Default import limits are 32 MiB per file and 256 files. Override with
  `IMGCONVERT_REAL_CORPUS_MAX_BYTES` and `IMGCONVERT_REAL_CORPUS_MAX_FILES`.
- A local manifest is written to
  `target/fuzz-corpus/real-corpus-manifest.json`; it records basenames, hashes,
  sizes, and generated seed paths, not full source paths.
- The replay report stores repository-relative seed paths, or only basenames for
  external roots.

## Triage

`cargo-fuzz` stores core crashes under `fuzz/artifacts/<target>/` and Tauri
crashes under `src-tauri/fuzz/artifacts/<target>/`. Before sharing a minimized
input, confirm that it does not contain private photo data or copyrighted
material. If it does, reduce it locally or reproduce the bug with a generated
fixture.

To inspect pending crash artifacts without running a long minimization job:

```bash
pnpm run fuzz:minimize
```

That command currently inventories and minimizes the core fuzz crate; Tauri
artifacts are still replayed automatically but must be minimized from
`src-tauri/` with `cargo fuzz tmin`. The core command writes
`target/fuzz-corpus/minimize-report.json` and records only repository-relative
paths or basenames. To actually run `cargo fuzz tmin` for core artifacts:

```bash
cargo install cargo-fuzz
pnpm run fuzz:minimize:run
```

The run mode calls `cargo fuzz tmin <target> <artifact>` without a shell and then
replays `fuzz/artifacts/<target>/` through `pnpm run fuzz:replay -- --skip-prepare`.
You can narrow the work with `--target=decode_pipeline` or
`--artifact=fuzz/artifacts/decode_pipeline/<file>`.
