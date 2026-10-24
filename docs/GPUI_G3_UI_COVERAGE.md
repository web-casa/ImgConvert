# GPUI G3-3 UI test coverage matrix

Status: 2026-10-24 (after the Clear Glass 2.0 redesign #50–#53, the nine
interface languages #68 and the R4/R6 tests #69, #71). Scope: the GPUI shell's dialogs and main flows, plus the
headless drag/drop, thumbnail-eviction and pixel checks required by G3-3.
This file records what is automated, what was deliberately left to another
gate, and which checks still need a harness change.

## Evidence baseline

- `apps/gpui/crates/shell/tests/ui.rs`: 55 headless Kit UI tests in the real
  workspace.
- `apps/gpui/crates/shared/src/queue_model.rs`: thumbnail budget, replacement
  and stale-ticket tests, including release-once assertions.
- `apps/gpui/crates/queue/src/queue_view.rs`: drives the real
  `apply_thumbnail_result` release path after eviction.
- `apps/gpui/crates/shell/tests/pixels.rs` + `tests/support/pixels.rs`:
  solid-color, real Workspace and translucent preview-image captures.
- `apps/gpui/crates/shell/tests/pixels_macos.rs`: `harness = false` main-thread
  variant for Metal.
- CI: Linux uses Mesa lavapipe + Xvfb; macOS uses the Metal main-thread
  harness. Both run with `IMGCONVERT_PIXEL_TESTS=1` in their dedicated jobs.

## Dialogs

| Surface | Automated coverage | Status |
| --- | --- | --- |
| Privacy policy | `privacy_policy_is_offline_readonly_localized_and_restores_focus`, `legal_dialogs_focus_the_reading_control_on_open_and_restore_the_trigger` | Covered |
| Licenses | `licenses_include_the_full_gpui_and_native_notices_and_remain_copyable`, `legal_dialogs_...` | Covered |
| Plugin diagnostics | `plugin_diagnostics_dialog_probes_and_edits_the_helper` | Covered |
| Updates | `updates_dialog_explains_manual_preview_updates_and_escape_closes_it` | Covered |
| Output safety prompts | `start_walks_the_output_safety_prompts` | Covered |
| Environmental impact / storage scenario | `finished_items_open_the_storage_scenario_dialog` | Covered |
| Comparison preview | `comparison_preview_generates_marks_stale_and_releases`, `comparison_preview_steps_through_the_selected_pdf_pages` (page controls, rendered page colours, stale disables stepping) | Covered |
| Legal focus trap / Tab cycle | `legal_dialogs_focus_the_reading_control_on_open_and_restore_the_trigger` | Covered |
| Modal shielding from file drops | `external_file_drop_is_ignored_while_a_modal_is_open` | Covered |

## Main flows

| Flow | Automated coverage | Status |
| --- | --- | --- |
| Empty queue / start disabled | `empty_queue_shows_the_next_action_and_disables_start` | Covered |
| Language menu (nine languages) | `language_menu_and_toggle_rewrite_visible_labels` (radio group, checked state, keyboard on open, persistence for every locale) | Covered |
| Persisted format/folder edits | `persisted_format_and_folder_drive_the_panel_and_follow_its_edits` | Covered |
| Settings tabs, sections and controls | `settings_form_sections_render_and_edit_the_record` (incl. the cross-tab warning), `settings_controls_expose_native_names_roles_and_toggle_state` (tab and format-card roles, selected state, tab-list and card-group arrow keys, Tab order, focus kept while busy) | Covered |
| Appearance popover | `theme_preference_and_reduced_motion_follow_the_settings_record` (popover theme group, arrow keys, reduce motion), `glass_layout_keeps_actions_visible_and_appearance_preserves_settings` (opens in the window, Escape closes) | Covered |
| Settings write coalescing | `settings_edits_coalesce_into_one_write_and_flush_on_demand` | Covered |
| External file drop import | `external_file_drop_imports_a_png_into_an_empty_queue` | Covered |
| Drop cancel (exit) | `external_file_drag_exit_does_not_import` | Covered |
| Clipboard import and cancellation | `clipboard_bitmap_button_...`, `clipboard_empty_invalid_partial_and_cancelled_imports_...`, `clipboard_partial_path_errors_...` | Covered |
| Clipboard paste in settings input | `clipboard_paste_in_a_settings_input_edits_text_without_importing` | Covered |
| Output suffix feedback | `suffix_feedback_*` (3 tests) | Covered |
| Per-item formats | `item_formats_menu_drives_mixed_outputs_and_reset` | Covered |
| Start / finish / retry / next batch | `queued_items_render_rows_and_let_start_run`, `parity_next_batch_keeps_completed_items_and_converts_only_new_inputs` | Covered |
| Cancel a running batch | `cancel_stops_a_running_batch_without_outputs` (held at the execution gate; Cancelling, cancelled summary, no output, files stay Pending) | Covered |
| Clear after a run | `ended_batch_leaves_the_capsule_once_its_files_leave_the_queue` | Covered |
| Quality slider pointer drag | `quality_slider_follows_a_pointer_drag` | Covered |
| Select Enter / Escape | `select_confirms_with_enter_and_escape_keeps_the_value` | Covered |
| System appearance change | `system_theme_follows_the_platform_appearance` (vendored test hook `simulate_window_appearance_change`) | Covered |
| Finished summary and net saving | `finished_batch_summary_names_the_net_saving` (earlier rows and failures; `net_saving` and `size_change` unit tests) | Covered |
| Long failure reason at the minimum size | `long_failure_reasons_stay_clear_of_the_row_commands` | Covered |
| Scan failures / stop / partial errors | `parity_scan_reports_failures_and_stop_preserves_existing_queue`, `parity_structured_errors_retranslate_and_remove_preserves_sources` | Covered |
| PDF import and source format menu | `parity_pdf_import_metadata_and_source_format_menu` | Covered |
| Remove / cleanup source | `parity_remove_clipboard_item_cleans_only_its_registered_file` | Covered |
| Animation / precision warnings | `animation_facts_mark_rows_and_count_pending_inputs_before_decode`, `precision_warnings_survive_queue_completion_and_retranslate` | Covered |
| Running-batch appearance command / busy protection | `appearance_command_preserves_a_nonempty_running_batch` | Covered |
| Quality floor keyboard limits | `quality_floor_keyboard_steps_cross_off_and_respect_limits_and_busy` | Covered |
| Queue item roles/metadata/result states | `queue_content_exposes_names_metadata_and_every_result_state` | Covered |
| Small-window glass layout (760×480 in all nine languages, 1000×640 and 1280×800 in en/zh, light/dark, 115% font for the capsule) | `glass_layout_keeps_actions_visible_and_appearance_preserves_settings`, `finished_items_open_the_storage_scenario_dialog` | Covered |

## Nonfunctional paths required by G3-3

| Path | Coverage | Status |
| --- | --- | --- |
| Drag/drop import | UI test with `FileDropEvent` Entered → Pending → Submit | Covered |
| Drag cancel | Entered → Exited leaves the queue empty | Covered |
| Thumbnail eviction state / bytes | model budget tests | Covered |
| Thumbnail release after eviction | queue-view `apply_thumbnail_result` test | Covered |
| Stale ticket returns image | model test | Covered |
| Pixel rendering, Linux | lavapipe CI job | Covered |
| Pixel rendering, macOS | Metal main-thread CI job | Covered |
| Preview image alpha contract | `headless_renderer_blends_a_translucent_preview_image`: red 100 at alpha 128 over white renders (177, 127, 127), so preview frames are straight BGRA as GPUI's own decoder produces | Covered |

## Remaining automated-coverage gaps

The R4 and R6 gaps listed here before 2026-10-24 (slider pointer drag, Select
confirm/Escape, system appearance event, PDF per-page preview, preview alpha)
are closed by the tests above. What remains:

1. **HiDPI scale of preview images (R6).** The alpha check renders at the
   headless scale factor of 2; there is no assertion that a preview image keeps
   one source pixel per device pixel at other scale factors.
2. **10k queue memory observation (R6).** Unit-level eviction is covered; the
   10k-row memory figure belongs to the full-candidate measurement (G3-5).
3. **Glass decision and 760 px screenshot review (R8).** Done: Clear Glass 2.0
   was chosen on 2026-10-22, the 760×480 layout invariants are asserted in all
   nine languages, and native macOS screenshots of every language were reviewed
   on 2026-10-24 (the long-label truncations they found were fixed in #70).

## Native G2 items

Native VoiceOver, IME and sandbox evidence lives in `GPUI_G2_ACCEPTANCE.md`
(final-candidate rounds on 2026-10-24, with recordings), not in this matrix.

## How to run

```bash
cd apps/gpui
cargo test --workspace --locked

# Linux GPU-capable host:
IMGCONVERT_PIXEL_TESTS=1 cargo test -p imgconvert-gpui --test pixels --locked

# macOS (main thread, Metal):
IMGCONVERT_PIXEL_TESTS=1 cargo test -p imgconvert-gpui --test pixels_macos --locked
```

The normal `pixels` test skips on macOS worker threads by design; use
`pixels_macos` there.
