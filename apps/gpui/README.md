# ImgConvert GPUI shell

Stage 2 technical proof of `docs/GPUI_MIGRATION_PLAN.md`: the desktop shell on
[GPUI Kit](https://gpui-kit.com) (`gpui-kit = "=0.7.1"`), built on the shared
`imgconvert-backend` → `imgconvert-platform` → `imgconvert-core` crates. It is
a separate Cargo workspace with its own lockfile so neither the Tauri shell nor
the root workspace ever compiles GPUI.

## Layout

| Crate                              | Role                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/shell` (`imgconvert-gpui`) | `main`, window, menus, key bindings, locale switch, perf-probe driver                                                                                                                         |
| `crates/shared`                    | Retained models (`QueueModel`, `BatchModel`, `SettingsModel`), service globals, progress bridge, file prompts, strings, perf probe                                                            |
| `crates/queue`                     | Import (drop, picker, scan), virtualized queue list, bounded thumbnail loading                                                                                                                |
| `crates/workflow`                  | The conversion settings form (`SettingsForm`: format, quality, output, policies, format parameters, presets, PDF, resize, target size, metadata), output folder, start/cancel, batch progress |
| `crates/preview`                   | Before/after comparison dialog for one queue item (backend preview workflow, reveal slider, stats, warnings)                                                                                  |

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

## Settings

The shell reads and writes the Tauri shell's `settings.json` (same file, same
`settings` key, same normalization; see `docs/GPUI_SETTINGS_PATHS.md` for the
per-platform path). Format, output folder and language changes are saved
300 ms after the last edit and on quit; the first write keeps a
`settings.json.pre-gpui` backup. An `instance.lock` next to it stops the Tauri
and GPUI shells from running at the same time.

## Scope

Stage 2 proof plus the first three stage 3 slices: import by drop or picker,
virtual queue with thumbnails, the full conversion settings form with scenario
presets (every field the Tauri shell persists), the before/after comparison
preview, the output-safety prompts before Start (queued-source conflicts,
overwrite "ask", source replacement), start/cancel with progress, and the
English/Chinese switch. No HEIC
helper picker, plugin diagnostics, updater or store packaging yet; those are
the remaining stage 3 work and keep shipping through the Tauri line meanwhile.
