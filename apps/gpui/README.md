# ImgConvert GPUI shell

Stage 2 technical proof of `docs/GPUI_MIGRATION_PLAN.md`: the desktop shell on
[GPUI Kit](https://gpui-kit.com) (`gpui-kit = "=0.7.1"`), built on the shared
`imgconvert-backend` → `imgconvert-platform` → `imgconvert-core` crates. It is
a separate Cargo workspace with its own lockfile so neither the Tauri shell nor
the root workspace ever compiles GPUI.

## Layout

| Crate                              | Role                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `crates/shell` (`imgconvert-gpui`) | `main`, window, menus, key bindings, locale switch, perf-probe driver                                             |
| `crates/shared`                    | Retained models (`QueueModel`, `BatchModel`), service globals, progress bridge, file prompts, strings, perf probe |
| `crates/queue`                     | Import (drop, picker, scan), virtualized queue list, bounded thumbnail loading                                    |
| `crates/workflow`                  | Output format, output folder, start/cancel, batch progress                                                        |

Feature crates depend on `shared`; nothing depends on `shell`. Every crate
reaches GPUI through `gpui_kit` only. `scripts/check-architecture-guardrails.mjs`
enforces both rules.

## Build and test

```bash
cd apps/gpui
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked          # unit tests + headless Kit UI tests
cargo run --release -p imgconvert-gpui   # the shell
```

Linux needs `libxkbcommon-dev libxkbcommon-x11-dev libwayland-dev
libx11-xcb-dev libxcb1-dev libfontconfig1-dev libvulkan-dev` plus the codec
toolchain of the root workspace (`cmake`, `meson`, `ninja`, `nasm`). macOS needs
only the Command Line Tools: GPUI Kit enables `runtime_shaders`, so no Metal
compiler from a full Xcode is required.

## Perf probe

The shell implements the `IMGCONVERT_PERF_PROBE` protocol of
`docs/GPUI_BASELINE.md` (§2, §7) with the same marks as the Tauri shell:

```bash
IMGCONVERT_PERF_PROBE=1 \
IMGCONVERT_PERF_PROBE_IMPORT=~/imgconvert-bench/corpus-1k \
IMGCONVERT_PERF_PROBE_SCROLL=1 \
  target/release/imgconvert-gpui
```

`scripts/measure-desktop-baseline.mjs --app=apps/gpui/target/release/imgconvert-gpui --label=gpui`
runs the startup, import and manual-batch scenarios against it and writes
results under `artifacts/baseline/`. With `--batch-out=<dir>` the shell starts
the batch itself (`IMGCONVERT_PERF_PROBE_BATCH_OUT`), so the manual-batch
scenario needs no operator; `--batch-format=avif` picks the format the Tauri
baseline was measured with.

## Scope of the proof

Import by drop or picker, virtual queue with thumbnails, format selection,
start/cancel with progress, and the English/Chinese switch. No settings panel,
comparison preview, updater, PDF options or store packaging yet; those are
stage 3 work and keep shipping through the Tauri line until gate G2 passes.
