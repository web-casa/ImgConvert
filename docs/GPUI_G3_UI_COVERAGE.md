# GPUI G3-3 UI test coverage matrix

Status: 2026-10-22. Scope: the GPUI shell's dialogs and main flows, plus the
headless drag/drop, thumbnail-eviction and pixel checks required by G3-3.
This file records what is automated, what was deliberately left to another
gate, and which checks still need a harness change.

## Evidence baseline

- `apps/gpui/crates/shell/tests/ui.rs`: 41 headless Kit UI tests in the real
  workspace.
- `apps/gpui/crates/shared/src/queue_model.rs`: thumbnail budget, replacement
  and stale-ticket tests, including release-once assertions.
- `apps/gpui/crates/queue/src/queue_view.rs`: drives the real
  `apply_thumbnail_result` release path after eviction.
- `apps/gpui/crates/shell/tests/pixels.rs` + `tests/support/pixels.rs`:
  solid-color and real Workspace captures.
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
| Comparison preview | `comparison_preview_generates_marks_stale_and_releases` | Covered |
| Legal focus trap / Tab cycle | `legal_dialogs_focus_the_reading_control_on_open_and_restore_the_trigger` | Covered |
| Modal shielding from file drops | `external_file_drop_is_ignored_while_a_modal_is_open` | Covered |

## Main flows

| Flow | Automated coverage | Status |
| --- | --- | --- |
| Empty queue / start disabled | `empty_queue_shows_the_next_action_and_disables_start` | Covered |
| Language toggle | `language_toggle_rewrites_visible_labels` | Covered |
| Persisted format/folder edits | `persisted_format_and_folder_drive_the_panel_and_follow_its_edits` | Covered |
| Settings sections and controls | `settings_form_sections_render_and_edit_the_record`, `settings_controls_expose_native_names_roles_and_toggle_state` | Covered |
| Settings write coalescing | `settings_edits_coalesce_into_one_write_and_flush_on_demand` | Covered |
| External file drop import | `external_file_drop_imports_a_png_into_an_empty_queue` | Covered |
| Drop cancel (exit) | `external_file_drag_exit_does_not_import` | Covered |
| Clipboard import and cancellation | `clipboard_bitmap_button_...`, `clipboard_empty_invalid_partial_and_cancelled_imports_...`, `clipboard_partial_path_errors_...` | Covered |
| Clipboard paste in settings input | `clipboard_paste_in_a_settings_input_edits_text_without_importing` | Covered |
| Output suffix feedback | `suffix_feedback_*` (3 tests) | Covered |
| Per-item formats | `item_formats_menu_drives_mixed_outputs_and_reset` | Covered |
| Start / finish / retry / next batch | `queued_items_render_rows_and_let_start_run`, `parity_next_batch_keeps_completed_items_and_converts_only_new_inputs` | Covered |
| Scan failures / stop / partial errors | `parity_scan_reports_failures_and_stop_preserves_existing_queue`, `parity_structured_errors_retranslate_and_remove_preserves_sources` | Covered |
| PDF import and source format menu | `parity_pdf_import_metadata_and_source_format_menu` | Covered |
| Remove / cleanup source | `parity_remove_clipboard_item_cleans_only_its_registered_file` | Covered |
| Animation / precision warnings | `animation_facts_mark_rows_and_count_pending_inputs_before_decode`, `precision_warnings_survive_queue_completion_and_retranslate` | Covered |
| Running-batch navigation / busy protection | `card_navigation_preserves_a_nonempty_running_batch` | Covered |
| Quality floor keyboard limits | `quality_floor_keyboard_steps_cross_off_and_respect_limits_and_busy` | Covered |
| Queue item roles/metadata/result states | `queue_content_exposes_names_metadata_and_every_result_state` | Covered |
| Small-window card layout | `card_layout_keeps_actions_visible_and_shortcuts_preserve_settings` | Covered |

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

## Remaining automated-coverage gaps

1. **Real slider pointer drag (R4).** The current headless pointer dispatch did
   not move the Kit slider thumb in the real settings form; the test was not
   merged. Keyboard stepping is covered by
   `quality_floor_keyboard_steps_cross_off_and_respect_limits_and_busy`.
   Revisit after Kit exposes a stable track/thumb test id or a pointer-drag
   helper for composed sliders.
2. **Real Select confirm/Escape (R4).** Confirm and Escape are exercised through
   the item-format popup; a dedicated adapter-level test using a bare `Select`
   is still worth adding.
3. **System appearance event (R4).** Theme preference and reduced motion follow
   the settings record, but no test dispatches an actual OS appearance change.
4. **PDF per-page preview selection (R6).** Current preview opens the first
   page, matching Tauri; per-page selection is not implemented.
5. **HiDPI transparent PNG premultiplied alpha (R6).** The pixel checks assert
   non-blank workspace output, not the alpha/scale contract on a transparent
   fixture.
6. **10k queue memory observation (R6).** Unit-level eviction is covered;
   no 10k-row memory measurement is automated.
7. **Glass decision and 760 px screenshot review (R8).** Design decision and
   screenshot comparison, not a headless assertion.

## Native G2 items deliberately excluded

These are not covered by this matrix and remain G2 evidence work:

- VoiceOver speech for running progress and alerts (completed status is
  recorded; run/alert speech is not).
- Full legal-body scrolling under VoiceOver.
- Continuous IME video.
- Actual sandbox revocation/regrant.

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
