// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! UI integration tests: the real workspace in a headless window.

use gpui_kit::component::WindowExt as _;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    AppContext, Bounds, ExternalPaths, FileDropEvent, InputEvent, TestAppContext, WindowBounds,
    WindowOptions, point, px, size,
};
use imgconvert_backend::settings::{AppLocale, Settings};
use imgconvert_gpui::{Workspace, init_app, toggle_language};
use imgconvert_gpui_shared::i18n::{Locale, set_locale};
use imgconvert_gpui_shared::{AppModels, ItemStatus, SettingsModel, progress_bridge, services};

/// The interface locale is process-wide (`rust_i18n`), and the test harness
/// runs tests on parallel threads: every test that opens a workspace holds
/// this lock so one test's locale switch cannot leak into another's labels.
static LOCALE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn locale_guard() -> std::sync::MutexGuard<'static, ()> {
    LOCALE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn open_workspace(
    cx: &mut TestAppContext,
) -> (gpui_kit::AnyWindowHandle, gpui_kit::Entity<Workspace>) {
    open_workspace_sized(cx, size(px(1_000.), px(640.)))
}

/// A window of the given size; tall windows keep the lower settings
/// sections inside the viewport so they can be clicked.
fn open_workspace_sized(
    cx: &mut TestAppContext,
    window_size: gpui_kit::Size<gpui_kit::Pixels>,
) -> (gpui_kit::AnyWindowHandle, gpui_kit::Entity<Workspace>) {
    cx.update(|cx| {
        // Tests never touch the real per-user store.
        services::init_with_settings(cx, || SettingsModel::in_memory(Settings::default()));
        init_app(cx);
        set_locale(Locale::English);
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    gpui_kit::Point::default(),
                    window_size,
                ))),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Workspace::new(window, cx)),
        )
        .expect("open test window")
    })
}

#[gpui_kit::test]
fn empty_queue_shows_the_next_action_and_disables_start(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("queue-empty").visible());
        assert!(window.find("queue-empty-add").visible());
        // The fixed footer keeps the decision and its status together.
        assert!(window.find("workflow-action-bar").visible());
        assert!(window.find("workflow-start").visible());
        assert_eq!(
            window.find("workflow-status").value(),
            Some("Add files to begin")
        );
        assert_eq!(
            window.find("workflow-output-dir").label(),
            Some("Chosen when you start")
        );
        // Start on an empty queue is disabled: clicking must not start a batch.
        window.click("workflow-start", cx);
    })
    .unwrap();
    cx.update(|cx| {
        assert!(!AppModels::global(cx).batch().read(cx).is_active());
    });
}

#[gpui_kit::test]
fn external_file_drop_imports_a_png_into_an_empty_queue(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!("imgconvert-gpui-drop-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("dropped.png");
    std::fs::write(&input, one_by_one_png()).unwrap();
    let paths = ExternalPaths([input.clone()].into_iter().collect());

    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let position = point(px(400.), px(300.));
        window.dispatch_event(
            FileDropEvent::Entered {
                position,
                paths: paths.clone(),
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(FileDropEvent::Pending { position }.to_platform_input(), cx);
        window.dispatch_event(FileDropEvent::Submit { position }.to_platform_input(), cx);
    })
    .unwrap();
    wait_for_import(cx);

    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert_eq!(queue.len(), 1);
        let item = &queue.items()[0];
        assert_eq!(item.name.as_ref(), "dropped.png");
        assert_eq!(item.path.as_ref(), input.to_string_lossy());
        assert!(
            matches!(item.status, ItemStatus::Pending),
            "{:?}",
            item.status
        );
    });
    let _ = std::fs::remove_dir_all(&dir);
}

#[gpui_kit::test]
fn external_file_drop_is_ignored_while_a_modal_is_open(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    let dir =
        std::env::temp_dir().join(format!("imgconvert-gpui-drop-modal-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("behind-dialog.png");
    std::fs::write(&input, one_by_one_png()).unwrap();
    let paths = ExternalPaths([input.clone()].into_iter().collect());

    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("privacy-open", cx);
        window.render_frame(cx);
        assert!(window.has_active_dialog(cx));
        let position = point(px(400.), px(300.));
        window.dispatch_event(
            FileDropEvent::Entered { position, paths }.to_platform_input(),
            cx,
        );
        window.dispatch_event(FileDropEvent::Pending { position }.to_platform_input(), cx);
        window.dispatch_event(FileDropEvent::Submit { position }.to_platform_input(), cx);
        window.render_frame(cx);
        assert!(window.has_active_dialog(cx));
    })
    .unwrap();
    wait_for_import(cx);

    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert!(
            queue.is_empty(),
            "modal must shield the queue from file drops"
        );
    });
    let _ = std::fs::remove_dir_all(&dir);
}

#[gpui_kit::test]
fn external_file_drag_exit_does_not_import(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    let dir =
        std::env::temp_dir().join(format!("imgconvert-gpui-drop-exit-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("cancelled.png");
    std::fs::write(&input, one_by_one_png()).unwrap();
    let paths = ExternalPaths([input.clone()].into_iter().collect());

    cx.update_window(handle, |_, window, cx| {
        window.dispatch_event(
            FileDropEvent::Entered {
                position: point(px(20.), px(30.)),
                paths,
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(FileDropEvent::Exited.to_platform_input(), cx);
    })
    .unwrap();
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert!(queue.is_empty(), "drag exit must not import");
    });
    let _ = std::fs::remove_dir_all(&dir);
}

#[gpui_kit::test]
fn language_toggle_rewrites_visible_labels(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("nav-queue").label(), Some("Queue"));
        window.click("language-toggle", cx);
        window.render_frame(cx);
        assert_eq!(window.find("nav-queue").label(), Some("队列"));
    })
    .unwrap();
    cx.update(|cx| {
        let settings = AppModels::global(cx).settings().read(cx);
        assert_eq!(
            settings.settings().locale,
            AppLocale::ZhCn,
            "toggle persists"
        );
    });
    cx.update(toggle_language);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("nav-queue").label(), Some("Queue"));
    })
    .unwrap();
    cx.update(|cx| {
        let settings = AppModels::global(cx).settings().read(cx);
        assert_eq!(settings.settings().locale, AppLocale::EnUs);
    });
}

#[gpui_kit::test]
fn persisted_format_and_folder_drive_the_panel_and_follow_its_edits(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    // A record written by the Tauri shell: png output into a chosen folder.
    cx.update(|cx| {
        let mut settings = Settings::default();
        settings.format = "png".into();
        settings.out_dir = Some("/persisted/out".into());
        services::init_with_settings(cx, || SettingsModel::in_memory(settings));
    });
    let (handle, workspace) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let workflow = workspace.read(cx).workflow().clone();
        assert_eq!(workflow.read(cx).selected_format(cx).as_ref(), "png");
        assert_eq!(
            workflow.read(cx).output_dir(cx).as_deref(),
            Some(std::path::Path::new("/persisted/out"))
        );
        assert_eq!(
            window.find("workflow-output-dir").label(),
            Some("/persisted/out")
        );
        // Start reads "Start", not "Start…": no folder prompt will open.
        assert_eq!(window.find("workflow-start").label(), Some("Start"));

        workflow.update(cx, |workflow, cx| {
            workflow.set_format("jpeg", window, cx);
            workflow.set_format("not-a-format", window, cx);
            workflow.set_output_dir("/other/out".into(), cx);
        });
    })
    .unwrap();
    cx.update(|cx| {
        let settings = AppModels::global(cx).settings().read(cx);
        assert_eq!(settings.settings().format, "jpeg");
        assert_eq!(settings.settings().out_dir.as_deref(), Some("/other/out"));
    });
}

#[gpui_kit::test]
fn settings_form_sections_render_and_edit_the_record(cx: &mut TestAppContext) {
    use imgconvert_backend::settings::ResizeMode;
    use imgconvert_gpui_workflow::{NumberField, Section, SliderKind};

    let _locale = locale_guard();

    let (handle, workspace) = open_workspace(cx);
    let form = cx.update(|cx| {
        workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone()
    });

    // Every section renders in a real window, for every writable format.
    for format in ["jpeg", "png", "webp", "avif"] {
        cx.update_window(handle, |_, window, cx| {
            form.update(cx, |form, cx| form.set_format(format, window, cx));
            for section in Section::ALL {
                form.update(cx, |form, cx| form.set_open_section(Some(section), cx));
                window.render_frame(cx);
            }
        })
        .unwrap();
    }

    // A switch in an open section writes through to the settings model. The
    // accordion body springs open, so the clock advances until it settled.
    cx.update(|cx| {
        form.update(cx, |form, cx| {
            form.set_open_section(Some(Section::Compression), cx);
        });
    });
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, cx| {
        // The first row of the section is inside the scroll viewport; AVIF
        // supports lossless, so the switch is enabled.
        assert!(window.find("switch-lossless").visible());
        window.click("switch-lossless", cx);
    })
    .unwrap();
    cx.update(|cx| {
        assert!(
            AppModels::global(cx)
                .settings()
                .read(cx)
                .settings()
                .lossless
        );
    });

    // Target size on a lossless-capable AVIF target is refused; on JPEG it
    // turns auto quality and lossless off.
    cx.update_window(handle, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.set_target_size_enabled(true, cx);
            assert!(
                !AppModels::global(cx)
                    .settings()
                    .read(cx)
                    .settings()
                    .target_size_enabled
            );
            form.set_format("jpeg", window, cx);
            form.set_target_size_enabled(true, cx);
        });
        let settings = AppModels::global(cx).settings().read(cx).settings().clone();
        assert!(settings.target_size_enabled && !settings.auto_quality && !settings.lossless);
    })
    .unwrap();

    // Presets: apply a built-in, save the current record, delete it again.
    cx.update(|cx| {
        form.update(cx, |form, cx| {
            form.apply_preset("builtin:email", cx);
            let settings = AppModels::global(cx).settings().read(cx).settings().clone();
            assert_eq!(settings.format, "jpeg");
            assert_eq!(settings.resize_mode, ResizeMode::LongestEdge);
            assert_eq!(settings.resize_value, 1600);
            assert_eq!(
                imgconvert_backend::workflow_presets::matching_workflow_preset_id(&settings)
                    .as_deref(),
                Some("builtin:email")
            );
            let id = form.save_preset("  Mine ", cx).expect("saved");
            assert!(
                form.save_preset("   ", cx).is_none(),
                "empty names are refused"
            );
            let settings = AppModels::global(cx).settings().read(cx).settings().clone();
            assert_eq!(settings.custom_workflow_presets.len(), 1);
            assert_eq!(settings.custom_workflow_presets[0].name, "Mine");
            assert!(form.delete_preset(&id, cx));
            assert!(!form.delete_preset("builtin:email", cx));
            assert!(
                AppModels::global(cx)
                    .settings()
                    .read(cx)
                    .settings()
                    .custom_workflow_presets
                    .is_empty()
            );
        });
    });

    // Numeric fields clamp like the Svelte inputs; percentage caps at 400.
    cx.update(|cx| {
        form.update(cx, |form, cx| {
            form.commit_number(NumberField::PdfDpi, "999", cx);
            form.commit_number(NumberField::TargetSizeKib, "abc", cx);
            form.set_resize_mode(ResizeMode::Percentage, cx);
            let settings = AppModels::global(cx).settings().read(cx).settings().clone();
            assert_eq!(settings.pdf_dpi, 600);
            assert_eq!(settings.target_size_kib, 1024);
            assert_eq!(settings.resize_value, 400);
            assert!(!form.has_invalid_configuration(cx));
        });
    });

    // Two presets with the same name stay distinct by id.
    cx.update(|cx| {
        form.update(cx, |form, cx| {
            let first = form.save_preset("Twin", cx).expect("first twin");
            form.apply_slider(SliderKind::Quality, 42., cx);
            let second = form.save_preset("Twin", cx).expect("second twin");
            assert_ne!(first, second);
            form.apply_slider(SliderKind::Quality, 77., cx);
            form.apply_preset(&second, cx);
            let settings = AppModels::global(cx).settings().read(cx).settings().clone();
            assert_eq!(settings.quality, 42);
            form.apply_preset(&first, cx);
            let settings = AppModels::global(cx).settings().read(cx).settings().clone();
            assert_eq!(settings.quality, 82, "the email preset's quality");
            form.delete_preset(&first, cx);
            form.delete_preset(&second, cx);
        });
    });

    // Sliders are keyboard-operable: focus the quality wrapper, press keys.
    cx.update_window(handle, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.set_open_section(None, cx);
            form.focus_slider(SliderKind::Quality, window, cx);
        });
        window.render_frame(cx);
        assert!(window.find("settings-quality").visible());
        window.press("right", cx);
        window.press("right", cx);
        window.press("pagedown", cx);
        let settings = AppModels::global(cx).settings().read(cx).settings().clone();
        assert_eq!(settings.quality, 82 + 2 - 10);
        window.press("end", cx);
        assert_eq!(
            AppModels::global(cx).settings().read(cx).settings().quality,
            100
        );
    })
    .unwrap();

    // Target size left on while switching to AVIF is an invalid configuration
    // that Start refuses and the section flags.
    cx.update_window(handle, |_, window, cx| {
        form.update(cx, |form, cx| form.set_format("avif", window, cx));
        assert!(form.read(cx).has_invalid_configuration(cx));
        form.update(cx, |form, cx| {
            form.set_open_section(Some(Section::TargetSize), cx);
        });
        window.render_frame(cx);
    })
    .unwrap();
}

#[gpui_kit::test]
fn comparison_preview_generates_marks_stale_and_releases(cx: &mut TestAppContext) {
    use imgconvert_gpui_preview::ComparisonPreview;

    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!(
        "imgconvert-gpui-preview-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("one.png");
    std::fs::write(&input, one_by_one_png()).unwrap();
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().clone();
        queue.update(cx, |queue, cx| {
            queue.add_files(vec![imgconvert_backend::import::ImportScanFile {
                path: input.to_string_lossy().into_owned(),
                key: "one".into(),
                relative_dir: None,
                metadata: None,
            }]);
            cx.notify();
        });
    });

    // Holding the backend's execution gate keeps the generation parked, so
    // the loading-time behaviour below is deterministic.
    let gate = cx.update(|cx| {
        imgconvert_gpui_shared::Services::global(cx)
            .batch()
            .execution_gate()
            .handle()
    });
    let held_gate = gate.lock().unwrap();

    // The row's Compare button opens the dialog and starts generating.
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("compare:one").visible());
        window.click("compare:one", cx);
    })
    .unwrap();
    // The row emits an event; the workspace opens the dialog once effects flush.
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.has_active_dialog(cx));
        assert!(window.find("comparison-preview").visible());
    })
    .unwrap();
    let preview = cx.update(|cx| {
        workspace
            .read(cx)
            .comparison_preview()
            .expect("the row opened a preview")
    });
    // While the first generation runs: a second refresh is ignored, a
    // settings change is remembered, and the disabled reveal takes no keys.
    cx.update_window(handle, |_, window, cx| {
        assert!(preview.read(cx).is_loading());
        assert_eq!(preview.read(cx).request_id(), 1);
        preview.update(cx, ComparisonPreview::refresh);
        assert_eq!(preview.read(cx).request_id(), 1, "no duplicate submission");
        let settings = AppModels::global(cx).settings().clone();
        settings.update(cx, |settings, cx| {
            settings.update(cx, |s| s.quality = 44);
        });
        window.render_frame(cx);
        window.press("end", cx);
        assert!((preview.read(cx).reveal() - 50.).abs() < f32::EPSILON);
    })
    .unwrap();
    drop(held_gate);
    wait_for_preview(cx, &preview);
    cx.update(|cx| {
        assert!(
            preview.read(cx).is_stale(),
            "a change during generation marks the landed result stale"
        );
    });
    cx.update(|cx| preview.update(cx, ComparisonPreview::refresh));
    wait_for_preview(cx, &preview);
    cx.update(|cx| {
        let preview = preview.read(cx);
        assert_eq!(preview.error(), None, "{:?}", preview.error());
        let summary = preview.summary().expect("summary");
        assert_eq!((summary.source_width, summary.source_height), (1, 1));
        assert_eq!((summary.output_width, summary.output_height), (1, 1));
        assert!(summary.output_size > 0);
        assert!(preview.has_images());
        assert!(!preview.is_stale());
    });

    // An output-affecting settings change marks the result stale; a refresh
    // regenerates and clears the flag.
    cx.update(|cx| {
        let settings = AppModels::global(cx).settings().clone();
        settings.update(cx, |settings, cx| {
            settings.update(cx, |s| s.quality = 33);
        });
    });
    // Observers run when effects flush, after the update above returns.
    cx.run_until_parked();
    cx.update(|cx| {
        assert!(preview.read(cx).is_stale());
        preview.update(cx, ComparisonPreview::refresh);
        assert!(preview.read(cx).is_loading());
    });
    wait_for_preview(cx, &preview);
    cx.update(|cx| {
        assert!(!preview.read(cx).is_stale());
        assert!(preview.read(cx).has_images());
    });

    // A per-item edit also invalidates the retained preview, without a
    // global settings change. Refresh must then encode the overridden format.
    cx.update(|cx| {
        AppModels::global(cx)
            .queue()
            .clone()
            .update(cx, |queue, cx| {
                assert!(queue.set_target_format(&"one".into(), Some("jpeg")));
                cx.notify();
            });
    });
    cx.run_until_parked();
    cx.update(|cx| {
        assert!(preview.read(cx).is_stale());
        preview.update(cx, ComparisonPreview::refresh);
    });
    wait_for_preview(cx, &preview);
    cx.update(|cx| assert!(!preview.read(cx).is_stale()));

    // Closing the dialog releases the preview entity.
    let weak = preview.downgrade();
    drop(preview);
    cx.update_window(handle, |_, window, cx| {
        window.close_all_dialogs(cx);
        window.render_frame(cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        assert!(!window_has_dialog(cx, handle));
        assert!(weak.upgrade().is_none(), "the dialog owned the preview");
    });
    let _ = std::fs::remove_dir_all(&dir);
}

#[gpui_kit::test]
fn start_walks_the_output_safety_prompts(cx: &mut TestAppContext) {
    use imgconvert_backend::settings::OverwriteMode;

    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!(
        "imgconvert-gpui-safety-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let out = dir.join("out");
    std::fs::create_dir_all(&out).unwrap();
    let input = dir.join("one.png");
    std::fs::write(&input, one_by_one_png()).unwrap();
    // The output of the default settings (avif, `_done`) already exists.
    std::fs::write(out.join("one_done.avif"), b"stale").unwrap();
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().clone();
        queue.update(cx, |queue, cx| {
            queue.add_files(vec![imgconvert_backend::import::ImportScanFile {
                path: input.to_string_lossy().into_owned(),
                key: "one".into(),
                relative_dir: None,
                metadata: None,
            }]);
            cx.notify();
        });
        let settings = AppModels::global(cx).settings().clone();
        settings.update(cx, |settings, cx| {
            settings.update(cx, |s| s.overwrite = OverwriteMode::Ask);
        });
        let workflow = workspace.read(cx).workflow().clone();
        workflow.update(cx, |workflow, cx| workflow.set_output_dir(out.clone(), cx));
    });
    let workflow = cx.update(|cx| workspace.read(cx).workflow().clone());

    // Ask mode: the existing output is confirmed; Escape is not an answer,
    // "Skip" keeps the stale file.
    click_start_and_wait_for_prompt(cx, handle, &workflow);
    cx.update_window(handle, |_, window, cx| {
        window.press("escape", cx);
        window.render_frame(cx);
        assert!(window.has_active_dialog(cx), "Escape must not answer Skip");
        assert!(window.find("cancel").visible());
        window.click("cancel", cx);
    })
    .unwrap();
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        let status = &queue.item(&"one".into()).unwrap().status;
        assert!(matches!(status, ItemStatus::Skipped { .. }), "{status:?}");
    });
    assert_eq!(std::fs::read(out.join("one_done.avif")).unwrap(), b"stale");

    // Ask again, this time "Overwrite": the file is replaced.
    click_start_and_wait_for_prompt(cx, handle, &workflow);
    cx.update_window(handle, |_, window, cx| window.click("ok", cx))
        .unwrap();
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        let status = &queue.item(&"one".into()).unwrap().status;
        assert!(matches!(status, ItemStatus::Done { .. }), "{status:?}");
    });
    assert_ne!(std::fs::read(out.join("one_done.avif")).unwrap(), b"stale");

    // Skip mode with an output that is its own source: one informational
    // prompt, then the batch runs and leaves the original alone.
    let original = std::fs::read(&input).unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-reset-formats", cx);
    })
    .unwrap();
    cx.update(|cx| {
        let settings = AppModels::global(cx).settings().clone();
        settings.update(cx, |settings, cx| {
            settings.update(cx, |s| {
                s.overwrite = OverwriteMode::Skip;
                s.format = "png".into();
                s.output_suffix_enabled = false;
            });
        });
        workflow.update(cx, |workflow, cx| workflow.set_output_dir(dir.clone(), cx));
    });
    click_start_and_wait_for_prompt(cx, handle, &workflow);
    cx.update_window(handle, |_, window, cx| window.click("ok", cx))
        .unwrap();
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        let status = &queue.item(&"one".into()).unwrap().status;
        assert!(matches!(status, ItemStatus::Skipped { .. }), "{status:?}");
    });
    assert_eq!(std::fs::read(&input).unwrap(), original);

    // Nothing to confirm (fresh folder, skip mode): no prompt, the batch runs.
    let fresh = dir.join("fresh");
    std::fs::create_dir_all(&fresh).unwrap();
    cx.update(|cx| {
        let settings = AppModels::global(cx).settings().clone();
        settings.update(cx, |settings, cx| {
            settings.update(cx, |s| s.output_suffix_enabled = true);
        });
        workflow.update(cx, |workflow, cx| {
            workflow.set_output_dir(fresh.clone(), cx);
        });
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("workflow-start", cx);
    })
    .unwrap();
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        assert!(!workflow.read(cx).is_planning());
        let queue = AppModels::global(cx).queue().read(cx);
        let status = &queue.item(&"one".into()).unwrap().status;
        assert!(matches!(status, ItemStatus::Done { .. }), "{status:?}");
    });
    assert!(fresh.join("one_done.png").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[gpui_kit::test]
fn plugin_diagnostics_dialog_probes_and_edits_the_helper(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("plugin-diagnostics", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let view = cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.has_active_dialog(cx));
            assert!(window.find("plugin-diagnostics-view").visible());
            workspace
                .read(cx)
                .plugin_diagnostics()
                .expect("the toolbar opened the dialog")
        })
        .unwrap();
    wait_until(cx, "diagnostics loaded", |cx| !view.read(cx).is_loading());
    cx.update_window(handle, |_, window, cx| {
        {
            let view = view.read(cx);
            assert_eq!(view.load_error(), None, "{:?}", view.load_error());
            let heic = &view.diagnostics().expect("diagnostics").heic;
            assert_eq!(
                heic.enabled,
                imgconvert_backend::external_codecs::heic_available()
            );
            assert_eq!(heic.extensions, vec!["heic", "heif", "hif"]);
        }
        window.render_frame(cx);
        assert!(window.find("diagnostics-heic-state").visible());
        assert!(window.find("diagnostics-summary").visible());
    })
    .unwrap();

    // Selecting a path that is not a usable helper keeps the choice (so the
    // diagnostic survives a restart) but reports it unavailable; clearing
    // forgets it.
    let bogus = std::env::temp_dir().join("imgconvert-no-such-helper");
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            view.set_helper_path(Some(bogus.to_string_lossy().into_owned()), cx);
        });
        assert!(view.read(cx).is_helper_busy());
    });
    wait_until(cx, "helper selected", |cx| {
        !view.read(cx).is_helper_busy() && !view.read(cx).is_loading()
    });
    cx.update_window(handle, |_, window, cx| {
        let settings = AppModels::global(cx).settings().read(cx).settings().clone();
        assert_eq!(
            settings.heic_helper_path.as_deref(),
            Some(bogus.to_string_lossy().as_ref())
        );
        {
            let heic = &view.read(cx).diagnostics().unwrap().heic;
            assert!(heic.selected_helper.configured && !heic.selected_helper.available);
        }
        window.render_frame(cx);
        // The manual-helper section sits below the fold of the 640 px test
        // window; the notice exists in the tree even when clipped.
        assert!(window.try_find("diagnostics-helper-notice").is_some());
        view.update(cx, |view, cx| view.set_helper_path(None, cx));
    })
    .unwrap();
    wait_until(cx, "helper cleared", |cx| {
        !view.read(cx).is_helper_busy() && !view.read(cx).is_loading()
    });
    cx.update(|cx| {
        let settings = AppModels::global(cx).settings().read(cx).settings().clone();
        assert_eq!(settings.heic_helper_path, None);
        assert!(
            !view
                .read(cx)
                .diagnostics()
                .unwrap()
                .heic
                .selected_helper
                .configured
        );
    });

    // A choice made right before the dialog closes is still persisted: the
    // process-wide helper changed, so the record must follow it.
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            view.set_helper_path(Some(bogus.to_string_lossy().into_owned()), cx);
        });
    });
    drop(view);
    cx.update_window(handle, |_, window, cx| {
        window.close_all_dialogs(cx);
        window.render_frame(cx);
    })
    .unwrap();
    wait_until(cx, "helper persisted after close", |cx| {
        AppModels::global(cx)
            .settings()
            .read(cx)
            .settings()
            .heic_helper_path
            .is_some()
    });
    cx.update(|cx| {
        assert!(workspace.read(cx).plugin_diagnostics().is_none());
        // Leave the process-wide helper as the other tests expect it.
        let _ = imgconvert_backend::external_codecs::set_selected_heic_helper(None);
    });
}

/// Pumps the executor until `condition` holds (blocking work runs on its
/// own thread; the timer wakes the foreground).
#[gpui_kit::test]
fn theme_preference_and_reduced_motion_follow_the_settings_record(cx: &mut TestAppContext) {
    use gpui_kit::component::{ActiveTheme as _, Theme, ThemeMode};
    use imgconvert_backend::settings::Theme as ThemePreference;
    use imgconvert_gpui_shared::theme::{ActiveGlass as _, DARK_THEME_NAME, LIGHT_THEME_NAME};
    use imgconvert_gpui_workflow::Section;

    fn edit(cx: &mut TestAppContext, apply: impl FnOnce(&mut Settings)) {
        cx.update(|cx| {
            let settings = AppModels::global(cx).settings().clone();
            settings.update(cx, |model, cx| {
                model.update(cx, apply);
            });
        });
        // The theme follows through an observer, which runs after the update.
        cx.run_until_parked();
    }

    let _locale = locale_guard();
    // Tall enough for the appearance section, the last one, to be clickable.
    let (handle, workspace) = open_workspace_sized(cx, size(px(1_000.), px(1_400.)));

    // "System" (the default) under the test platform's light appearance.
    cx.update(|cx| {
        assert_eq!(cx.theme().mode, ThemeMode::Light);
        assert_eq!(cx.theme().theme_name().as_ref(), LIGHT_THEME_NAME);
        assert_eq!(cx.glass().mode(), ThemeMode::Light);
        assert!(!cx.reduce_motion());
    });

    // An explicit preference wins over the system appearance.
    edit(cx, |settings| settings.theme = ThemePreference::Dark);
    cx.update(|cx| {
        assert!(cx.theme().is_dark());
        assert_eq!(cx.theme().theme_name().as_ref(), DARK_THEME_NAME);
        assert_eq!(cx.glass().mode(), ThemeMode::Dark);
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("workflow-action-bar").visible());
    })
    .unwrap();

    edit(cx, |settings| settings.reduce_motion = true);
    cx.update(|cx| assert!(cx.reduce_motion()));

    edit(cx, |settings| {
        settings.theme = ThemePreference::Light;
        settings.reduce_motion = false;
    });
    cx.update(|cx| {
        assert_eq!(cx.theme().mode, ThemeMode::Light);
        assert_eq!(cx.theme().theme_name().as_ref(), LIGHT_THEME_NAME);
        assert!(!cx.reduce_motion());
    });

    // An unrelated settings edit must not reload the theme file: a reload
    // would put the file's radius back over this sentinel.
    cx.update(|cx| Theme::update(cx, |theme| theme.radius = px(3.)));
    edit(cx, |settings| settings.quality = 55);
    cx.update(|cx| {
        assert_eq!(cx.theme().theme_name().as_ref(), LIGHT_THEME_NAME);
        assert_eq!(cx.theme().radius, px(3.), "no reload on an unrelated edit");
    });
    cx.update(|cx| Theme::update(cx, |theme| theme.radius = px(10.)));

    // The appearance section's switch writes the record, and the record
    // drives GPUI's reduced-motion flag.
    let form = cx.update(|cx| {
        workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone()
    });
    cx.update(|cx| {
        form.update(cx, |form, cx| {
            form.set_open_section(Some(Section::Appearance), cx);
        });
    });
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, cx| {
        assert!(window.find("workflow-theme").visible());
        assert!(window.find("switch-reduce-motion").visible());
        window.click("switch-reduce-motion", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        assert!(
            AppModels::global(cx)
                .settings()
                .read(cx)
                .settings()
                .reduce_motion
        );
        assert!(cx.reduce_motion());
    });

    // The new labels follow a locale switch like every other string.
    cx.update(toggle_language);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("workflow-status").value(), Some("先添加文件"));
    })
    .unwrap();
    cx.update(toggle_language);
}

fn wait_until(cx: &mut TestAppContext, what: &str, condition: impl Fn(&gpui_kit::App) -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_mins(1);
    loop {
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(50));
        cx.run_until_parked();
        if cx.update(|cx| condition(cx)) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting: {what}"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Clicks Start and pumps until the planning worker has produced a prompt.
fn click_start_and_wait_for_prompt(
    cx: &mut TestAppContext,
    handle: gpui_kit::AnyWindowHandle,
    workflow: &gpui_kit::Entity<imgconvert_gpui_workflow::WorkflowPanel>,
) {
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("workflow-start", cx);
    })
    .unwrap();
    cx.update(|cx| assert!(workflow.read(cx).is_planning()));
    let deadline = std::time::Instant::now() + std::time::Duration::from_mins(1);
    loop {
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(50));
        cx.run_until_parked();
        if cx.update(|cx| window_has_dialog(cx, handle)) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "no safety prompt appeared"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    cx.update_window(handle, |_, window, cx| window.render_frame(cx))
        .unwrap();
}

fn window_has_dialog(cx: &mut gpui_kit::App, handle: gpui_kit::AnyWindowHandle) -> bool {
    use gpui_kit::component::WindowExt as _;
    cx.update_window(handle, |_, window, cx| window.has_active_dialog(cx))
        .unwrap_or(false)
}

/// Pumps the executor until the preview finished generating (the backend
/// runs on the background executor; the timer wakes the foreground).
fn wait_for_preview(
    cx: &mut TestAppContext,
    preview: &gpui_kit::Entity<imgconvert_gpui_preview::ComparisonPreview>,
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_mins(1);
    loop {
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(50));
        cx.run_until_parked();
        if !cx.update(|cx| preview.read(cx).is_loading()) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "preview never finished"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Renders frames while advancing the test clock past Kit's spring motions.
fn settle_animations(cx: &mut TestAppContext, handle: gpui_kit::AnyWindowHandle) {
    for _ in 0..40 {
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(50));
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .unwrap();
    }
}

#[gpui_kit::test]
fn settings_edits_coalesce_into_one_write_and_flush_on_demand(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let dir = std::env::temp_dir().join(format!(
        "imgconvert-gpui-settings-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("settings.json");
    std::fs::write(
        &path,
        br#"{"other":{"keep":1},"settings":{"quality":70,"conversionPolicyVersion":2,"outputSuffixEnabled":true}}"#,
    )
    .unwrap();
    let model = cx.new(|_| SettingsModel::from_disk(path.clone(), AppLocale::EnUs));
    cx.update(|cx| {
        model.update(cx, |model, cx| {
            assert!(!model.is_dirty(), "a current record needs no startup write");
            assert!(model.update(cx, |s| s.quality = 71));
            assert!(model.update(cx, |s| s.quality = 72));
            assert!(
                !model.update(cx, |s| s.quality = 72),
                "no-op edits are ignored"
            );
        });
    });
    // Both edits sit inside one 300 ms window.
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(200));
    cx.run_until_parked();
    cx.update(|cx| assert_eq!(model.read(cx).save_count(), 0));
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(200));
    cx.run_until_parked();
    cx.update(|cx| {
        assert_eq!(model.read(cx).save_count(), 1);
        assert!(!model.read(cx).is_dirty());
    });
    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(written["settings"]["quality"], 72);
    assert_eq!(
        written["other"]["keep"], 1,
        "foreign top-level keys survive"
    );
    assert!(dir.join("settings.json.pre-gpui").exists());

    // Quit-time flush writes immediately without waiting for the timer.
    cx.update(|cx| {
        model.update(cx, |model, cx| {
            model.update(cx, |s| s.quality = 73);
            model.flush(cx).unwrap();
            assert_eq!(model.save_count(), 2);
        });
    });
    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(written["settings"]["quality"], 73);
    let _ = std::fs::remove_dir_all(&dir);
}

#[gpui_kit::test]
fn queued_items_render_rows_and_let_start_run(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!("imgconvert-gpui-ui-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("one.png");
    std::fs::write(&input, one_by_one_png()).unwrap();

    cx.update(|cx| {
        let models = AppModels::global(cx).clone();
        models.queue().update(cx, |queue, cx| {
            queue.add_files(vec![imgconvert_backend::import::ImportScanFile {
                path: input.to_string_lossy().into_owned(),
                key: "one".into(),
                relative_dir: None,
                metadata: None,
            }]);
            cx.notify();
        });
        let workflow = workspace.read(cx).workflow().clone();
        workflow.update(cx, |workflow, cx| {
            workflow.set_output_dir(dir.join("out"), cx);
            // The product picks the folder through NSOpenPanel, which exists;
            // the test creates it like the picker would have.
            std::fs::create_dir_all(dir.join("out")).unwrap();
        });
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("queue-empty").is_none());
        // Rows are observed by their stable item key.
        assert!(window.find("one").visible());
        window.click("workflow-start", cx);
    })
    .unwrap();

    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        let status = &queue.item(&"one".into()).unwrap().status;
        assert!(matches!(status, ItemStatus::Done { .. }), "{status:?}");
    });

    // Explicitly retry the completed item. The handoff must not drop the
    // previous bridge early, and the existing output is skipped, not clobbered.
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-reset-formats", cx);
        window.render_frame(cx);
        window.click("workflow-start", cx);
    })
    .unwrap();
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        let status = &queue.item(&"one".into()).unwrap().status;
        assert!(matches!(status, ItemStatus::Skipped { .. }), "{status:?}");
        let batch = AppModels::global(cx).batch().read(cx);
        assert_eq!(batch.skipped(), 1);
    });
    let produced: Vec<_> = std::fs::read_dir(dir.join("out"))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| e.file_name())
                .collect()
        })
        .unwrap_or_default();
    // The settings defaults decide the output: avif with the `_done` suffix.
    assert!(
        dir.join("out").join("one_done.avif").exists(),
        "expected one_done.avif in {:?}, found {produced:?}",
        dir.join("out")
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[gpui_kit::test]
fn finished_items_open_the_storage_scenario_dialog(cx: &mut TestAppContext) {
    use imgconvert_backend::environmental_impact::{ReplacementStatus, UnavailableReason};
    use imgconvert_gpui_impact::{ImpactSubject, ScenarioOutcome};

    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!("imgconvert-gpui-impact-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("out")).unwrap();
    let input = dir.join("one.png");
    std::fs::write(&input, one_by_one_png()).unwrap();

    cx.update(|cx| {
        let models = AppModels::global(cx).clone();
        models.queue().update(cx, |queue, cx| {
            queue.add_files(vec![imgconvert_backend::import::ImportScanFile {
                path: input.to_string_lossy().into_owned(),
                key: "one".into(),
                relative_dir: None,
                metadata: None,
            }]);
            cx.notify();
        });
    });
    // No scenario command before the item finished.
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("impact:one").is_none());
        assert!(window.try_find("workflow-impact").is_none());
    })
    .unwrap();
    cx.update(|cx| {
        let workflow = workspace.read(cx).workflow().clone();
        workflow.update(cx, |workflow, cx| {
            workflow.start_with_output_dir(dir.join("out"), Some("png".into()), cx);
        });
    });
    wait_for_batch_to_settle(cx);
    let (in_size, out_size) = cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        match &queue.item(&"one".into()).unwrap().status {
            ItemStatus::Done {
                in_size,
                out_size,
                comparable,
            } => {
                assert!(*comparable, "a single static PNG is comparable");
                (*in_size, *out_size)
            }
            other => panic!("{other:?}"),
        }
    });

    // The row's Scenario button opens the dialog for that item.
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("impact:one", cx);
    })
    .unwrap();
    let view = cx.update(|cx| {
        workspace
            .read(cx)
            .environmental_impact()
            .expect("the dialog holds the scenario view")
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("impact-view").visible());
        assert!(window.find("impact-measurement").visible());
        assert!(window.find("impact-storage").visible());
        // Local storage: bytes only, no estimate and no originals control.
        assert!(window.try_find("impact-result").is_none());
        assert!(window.try_find("impact-originals").is_none());
        assert_eq!(view.read(cx).subject(), &ImpactSubject::Item("one".into()));
        assert!(view.read(cx).is_comparable(cx));
        assert_eq!(view.read(cx).outcome(cx), None);

        view.update(cx, |view, cx| view.set_cloud(true, window, cx));
        window.render_frame(cx);
        assert!(window.find("impact-originals").visible());
        assert!(window.find("impact-days").visible());
        let outcome = view.read(cx).outcome(cx).expect("cloud scenario answers");
        if out_size < in_size {
            assert!(
                matches!(outcome, ScenarioOutcome::Estimate { .. }),
                "{outcome:?}"
            );
        } else {
            assert_eq!(
                outcome,
                ScenarioOutcome::Unavailable(UnavailableReason::NoReduction)
            );
        }

        // Retained originals never support a positive estimate; a blank or
        // out-of-range day count is reported, not computed.
        view.update(cx, |view, cx| {
            view.set_replacement(ReplacementStatus::Retained, window, cx);
        });
        assert_eq!(
            view.read(cx).outcome(cx),
            Some(ScenarioOutcome::Unavailable(
                UnavailableReason::OriginalRetained
            ))
        );
        view.update(cx, |view, cx| {
            view.set_replacement(ReplacementStatus::Confirmed, window, cx);
            view.set_days("9999", window, cx);
        });
        assert_eq!(view.read(cx).outcome(cx), Some(ScenarioOutcome::Invalid));
        view.update(cx, |view, cx| view.set_days("30", window, cx));
        assert_ne!(view.read(cx).outcome(cx), Some(ScenarioOutcome::Invalid));
        window.render_frame(cx);
        assert!(window.find("impact-result").visible());
        window.click("impact-close", cx);
    })
    .unwrap();
    // The test's own handle would keep the entity alive; only the dialog
    // may own it.
    drop(view);
    settle_animations(cx, handle);
    cx.update(|cx| {
        assert!(
            workspace.read(cx).environmental_impact().is_none(),
            "closing the dialog drops the view and its parameters"
        );
    });
    // Reopening starts from the defaults again: local storage, no estimate.
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("impact:one", cx);
    })
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let reopened = workspace.read(cx).environmental_impact().expect("reopened");
        assert_eq!(reopened.read(cx).outcome(cx), None);
        assert!(window.try_find("impact-originals").is_none());
        // The measurement line follows a locale switch like every string.
        let english = window.find("impact-measurement").label().map(str::to_owned);
        toggle_language(cx);
        window.render_frame(cx);
        let chinese = window.find("impact-measurement").label().map(str::to_owned);
        assert_ne!(english, chinese);
        assert!(
            chinese
                .as_deref()
                .is_some_and(|text| text.starts_with("输出")),
            "{chinese:?}"
        );
        toggle_language(cx);
        window.render_frame(cx);
        window.click("impact-close", cx);
    })
    .unwrap();
    settle_animations(cx, handle);

    // The action bar offers the batch scenario once a batch finished with a
    // comparable result; it counts eligible and excluded results.
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("workflow-impact").visible());
        window.click("workflow-impact", cx);
    })
    .unwrap();
    let batch_view = cx.update(|cx| {
        workspace
            .read(cx)
            .environmental_impact()
            .expect("batch view")
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(batch_view.read(cx).subject(), &ImpactSubject::Batch);
        assert_eq!(batch_view.read(cx).batch_counts(cx), Some((1, 0)));
        assert!(window.find("impact-measurement").visible());
        window.click("impact-close", cx);
    })
    .unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

/// Pumps the test executor until the batch and its bridge are done. The
/// backend runs on OS threads, so wall-clock waiting is unavoidable here.
fn wait_for_batch_to_settle(cx: &mut TestAppContext) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_mins(1);
    loop {
        // The bridge polls on a timer; the test clock only moves when advanced.
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(50));
        cx.run_until_parked();
        let (started, busy) = cx.update(|cx| {
            let batch = AppModels::global(cx).batch().read(cx);
            (batch.id().is_some(), progress_bridge::is_busy(cx))
        });
        if started && !busy {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "batch never settled");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

fn one_by_one_png() -> Vec<u8> {
    // Same fixture as the backend tests: a 1×1 opaque white RGBA PNG.
    let mut png = Vec::new();
    png.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    append_chunk(&mut png, *b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    let scanline = [0, 255, 255, 255, 255];
    let mut zlib = vec![0x78, 0x01, 0x01, 5, 0, 0xfa, 0xff];
    zlib.extend_from_slice(&scanline);
    zlib.extend_from_slice(&adler32(&scanline).to_be_bytes());
    append_chunk(&mut png, *b"IDAT", &zlib);
    append_chunk(&mut png, *b"IEND", &[]);
    png
}

fn append_chunk(png: &mut Vec<u8>, name: [u8; 4], data: &[u8]) {
    png.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut body = Vec::with_capacity(4 + data.len());
    body.extend_from_slice(&name);
    body.extend_from_slice(data);
    png.extend_from_slice(&body);
    png.extend_from_slice(&crc32(&body).to_be_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                0xEDB8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for byte in bytes {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

#[cfg(feature = "updater")]
#[gpui_kit::test]
fn updates_dialog_explains_manual_preview_updates_and_escape_closes_it(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("updates-open").visible());
        window.click("updates-open", cx);
        window.render_frame(cx);
        assert_eq!(
            window.find("update-status").label(),
            Some("Updates for this preview are supplied manually.")
        );
        window.click("update-check", cx);
        window.render_frame(cx);
        assert_eq!(
            window.find("update-status").label(),
            Some("Updates for this preview are supplied manually.")
        );
        window.press("escape", cx);
        window.render_frame(cx);
        assert!(window.try_find("update-close").is_none());
    })
    .unwrap();
}

fn clipboard_bitmap() -> gpui_kit::ClipboardItem {
    gpui_kit::ClipboardItem::new_image(&gpui_kit::Image::from_bytes(
        gpui_kit::ImageFormat::Png,
        one_by_one_png(),
    ))
}

fn wait_for_import(cx: &mut TestAppContext) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        cx.run_until_parked();
        if !cx.update(|cx| AppModels::global(cx).queue().read(cx).is_importing()) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "clipboard import never finished"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[gpui_kit::test]
fn clipboard_bitmap_button_imports_metadata_and_clears_only_managed_files(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace_sized(cx, size(px(760.), px(480.)));
    cx.update(|cx| cx.write_to_clipboard(clipboard_bitmap()));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-paste", cx);
        assert!(AppModels::global(cx).queue().read(cx).is_importing());
        // A repeated command in the same frame cannot create a second image.
        imgconvert_gpui_queue::clipboard::paste(cx);
        imgconvert_gpui_queue::import::import_paths(vec!["/not-scanned".into()], cx);
    })
    .unwrap();
    wait_for_import(cx);
    let path = cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert_eq!(queue.len(), 1);
        let item = queue.item_at(0).unwrap();
        assert_eq!(item.source_format.as_deref(), Some("png"));
        assert_eq!((item.source_width, item.source_height), (Some(1), Some(1)));
        std::path::PathBuf::from(item.path.as_ref())
    });
    assert_eq!(std::fs::read(&path).unwrap(), one_by_one_png());
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("queue-feedback").value(), Some("Added 1 files"));
        window.click("queue-clear", cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert!(
        !path.exists(),
        "clearing the queue cleans its managed image"
    );
    assert!(
        !path.parent().unwrap().exists(),
        "the marked session is cleaned too"
    );
}

#[gpui_kit::test]
fn clipboard_shortcut_imports_native_and_text_file_paths_without_deleting_sources(
    cx: &mut TestAppContext,
) {
    use gpui_kit::{ClipboardEntry, ClipboardItem, ClipboardString, ExternalPaths};
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!("imgconvert-clipboard-ui-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("photo with spaces.png");
    std::fs::write(&input, one_by_one_png()).unwrap();
    cx.update(|cx| {
        cx.write_to_clipboard(ClipboardItem {
            entries: vec![
                ClipboardEntry::ExternalPaths(ExternalPaths(
                    vec![input.clone(), input.clone()].into(),
                )),
                ClipboardEntry::String(ClipboardString::new("ignored text".into())),
                ClipboardEntry::Image(gpui_kit::Image::empty()),
            ],
        });
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("secondary-v", cx);
    })
    .unwrap();
    wait_for_import(cx);
    cx.update(|cx| {
        assert_eq!(AppModels::global(cx).queue().read(cx).len(), 1);
        let uri_path = input
            .to_str()
            .unwrap()
            .replace('\\', "/")
            .replace(' ', "%20");
        let uri = if cfg!(windows) {
            format!("file:///{uri_path}")
        } else {
            format!("file://{uri_path}")
        };
        cx.write_to_clipboard(ClipboardItem::new_string(format!(
            "copy\n# paths\n{uri}\n{uri}\nhttps://example.com/a.png"
        )));
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        // Native Edit > Paste dispatches this same standard action.
        window.dispatch_action(Box::new(gpui_kit::component::input::Paste), cx);
    })
    .unwrap();
    wait_for_import(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert_eq!(queue.len(), 1);
        assert_eq!(
            queue.feedback(),
            &imgconvert_gpui_shared::queue_model::ImportFeedback::Nothing,
            "the file URL resolves to the same queued file"
        );
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-clear", cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert!(
        input.exists(),
        "ordinary clipboard file paths remain user-owned"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[gpui_kit::test]
fn clipboard_empty_invalid_partial_and_cancelled_imports_leave_a_usable_queue(
    cx: &mut TestAppContext,
) {
    use gpui_kit::{ClipboardEntry, ClipboardItem, Image, ImageFormat};
    use imgconvert_gpui_shared::queue_model::ImportFeedback;
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    cx.update(|cx| {
        cx.write_to_clipboard(ClipboardItem::new_string("ordinary text".into()));
        imgconvert_gpui_queue::clipboard::paste(cx);
    });
    wait_for_import(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(
            window
                .find("queue-feedback")
                .value()
                .unwrap()
                .contains("Copy an image")
        );
    })
    .unwrap();
    cx.update(|cx| {
        cx.write_to_clipboard(ClipboardItem::new_image(&Image::from_bytes(
            ImageFormat::Png,
            vec![1, 2],
        )));
        imgconvert_gpui_queue::clipboard::paste(cx);
    });
    wait_for_import(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert!(queue.is_empty());
        assert!(matches!(
            queue.feedback(),
            ImportFeedback::Clipboard { added: 0, .. }
        ));
        cx.write_to_clipboard(clipboard_bitmap());
        imgconvert_gpui_queue::clipboard::paste(cx);
        assert!(imgconvert_gpui_queue::import::cancel_import(cx));
    });
    wait_for_import(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert!(queue.is_empty());
        assert_eq!(queue.feedback(), &ImportFeedback::Cancelled);
        let mut entries = clipboard_bitmap().entries;
        entries.push(ClipboardEntry::Image(Image::from_bytes(
            ImageFormat::Png,
            vec![1, 2],
        )));
        cx.write_to_clipboard(ClipboardItem { entries });
        imgconvert_gpui_queue::clipboard::paste(cx);
    });
    wait_for_import(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert_eq!(queue.len(), 1);
        assert!(matches!(queue.feedback(), ImportFeedback::Clipboard { added: 1, issues } if issues.contains(&imgconvert_gpui_shared::queue_model::ClipboardIssue::ImageIssues(1))));
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-clear", cx);
    })
    .unwrap();
    cx.run_until_parked();
}

#[gpui_kit::test]
fn clipboard_paste_in_a_settings_input_edits_text_without_importing(cx: &mut TestAppContext) {
    use imgconvert_gpui_workflow::Section;
    let _locale = locale_guard();
    let (handle, workspace) = open_workspace_sized(cx, size(px(1_000.), px(1_400.)));
    cx.update_window(handle, |_, window, cx| {
        let form = workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone();
        form.update(cx, |form, cx| {
            form.set_open_section(Some(Section::Output), cx);
        });
        window.render_frame(cx);
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update(|cx| cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string("pasted".into())));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("settings-output-suffix", cx);
        window.press("secondary-a", cx);
        window.press("secondary-v", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        let models = AppModels::global(cx);
        assert!(models.queue().read(cx).is_empty());
        assert!(!models.queue().read(cx).is_importing());
        assert_eq!(
            models.settings().read(cx).settings().output_suffix,
            "pasted"
        );
    });
}

fn open_output_suffix_editor(cx: &mut TestAppContext) -> gpui_kit::AnyWindowHandle {
    let (handle, workspace) = open_workspace_sized(cx, size(px(1_000.), px(1_400.)));
    cx.update_window(handle, |_, window, cx| {
        let form = workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone();
        form.update(cx, |form, cx| {
            form.set_open_section(Some(imgconvert_gpui_workflow::Section::Output), cx);
        });
        window.render_frame(cx);
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, cx| {
        window.activate_window();
        window.click("settings-output-suffix", cx);
        window.press("secondary-a", cx);
    })
    .unwrap();
    handle
}

#[gpui_kit::test]
fn suffix_feedback_clears_when_blur_restores_saved_text_after_preedit(cx: &mut TestAppContext) {
    use gpui_kit::EntityInputHandler as _;
    let _locale = locale_guard();
    let handle = open_output_suffix_editor(cx);
    cx.update_window(handle, |_, window, cx| {
        window.press("backspace", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let feedback = window.find("settings-output-suffix-feedback");
        assert!(feedback.visible());
        assert_eq!(feedback.role(), Some(gpui_kit::Role::Label));
        assert_eq!(
            feedback.value(),
            Some("Enter at least one character, or turn this switch off to omit the suffix.")
        );
        let input = window
            .focused_input(cx)
            .unwrap()
            .as_input()
            .unwrap()
            .clone();
        input.update(cx, |input, cx| {
            input.replace_and_mark_text_in_range(None, "ni hao", Some(6..6), window, cx);
            assert!(input.marked_text_range(window, cx).is_some());
        });
        assert_eq!(input.read(cx).value().as_ref(), "ni hao");
        assert_eq!(
            AppModels::global(cx)
                .settings()
                .read(cx)
                .settings()
                .output_suffix,
            "_done"
        );
        window.click("privacy-open", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("settings-output-suffix").value(), Some("_done"));
        assert!(window.try_find("settings-output-suffix-feedback").is_none());
        assert_eq!(
            AppModels::global(cx)
                .settings()
                .read(cx)
                .settings()
                .output_suffix,
            "_done"
        );
        window.press("escape", cx);
        window.click("settings-output-suffix", cx);
        window.press("secondary-a", cx);
        window.input("确定", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        assert_eq!(
            AppModels::global(cx)
                .settings()
                .read(cx)
                .settings()
                .output_suffix,
            "确定"
        );
    });
}

#[gpui_kit::test]
fn suffix_feedback_preserves_empty_draft_default_fallback(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let handle = open_output_suffix_editor(cx);
    cx.update_window(handle, |_, window, cx| {
        window.press("backspace", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| window.click("privacy-open", cx))
        .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("settings-output-suffix").value(), Some("_done"));
        assert!(window.find("settings-output-suffix-feedback").visible());
        assert_eq!(
            AppModels::global(cx)
                .settings()
                .read(cx)
                .settings()
                .output_suffix,
            "_done"
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn suffix_feedback_preserves_adjustment_when_confirming_safe_text(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let handle = open_output_suffix_editor(cx);
    cx.update(|cx| cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string("bad/".into())));
    cx.update_window(handle, |_, window, cx| window.press("secondary-v", cx))
        .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| window.press("enter", cx))
        .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("settings-output-suffix").value(), Some("bad_"));
        assert_eq!(
            window.find("settings-output-suffix-feedback").value(),
            Some(
                "Unsupported path characters were replaced and the safe length limit was applied."
            )
        );
        assert_eq!(
            AppModels::global(cx)
                .settings()
                .read(cx)
                .settings()
                .output_suffix,
            "bad_"
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn clipboard_stop_after_worker_completion_prevents_commit_and_cleans_the_bitmap(
    cx: &mut TestAppContext,
) {
    use imgconvert_gpui_shared::queue_model::ImportFeedback;
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    cx.run_until_parked();
    let sessions = || -> std::collections::BTreeSet<std::path::PathBuf> {
        std::fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("imgconvert-clipboard-")
            })
            .map(|entry| entry.path())
            .collect()
    };
    let before = sessions();
    cx.update(|cx| {
        cx.write_to_clipboard(clipboard_bitmap());
        imgconvert_gpui_queue::clipboard::paste(cx);
    });
    // Start the importer, then execute only its worker. The foreground result
    // stays pending while the user's Stop command is dispatched.
    while cx.dispatcher.tick(true) {}
    assert!(cx.dispatcher.tick(false));
    while cx.dispatcher.tick(true) {}
    let created: Vec<_> = sessions().difference(&before).cloned().collect();
    assert_eq!(
        created.len(),
        1,
        "the bitmap was written before cancellation"
    );
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(AppModels::global(cx).queue().read(cx).is_importing());
        window.click("queue-cancel-import", cx);
    })
    .unwrap();
    wait_for_import(cx);
    cx.run_until_parked();
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert!(queue.is_empty());
        assert_eq!(queue.feedback(), &ImportFeedback::Cancelled);
    });
    assert!(!created[0].exists(), "late cancellation cleans its session");
}

#[gpui_kit::test]
fn clipboard_cancelled_rescan_preserves_an_existing_managed_source(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    cx.update(|cx| {
        cx.write_to_clipboard(clipboard_bitmap());
        imgconvert_gpui_queue::clipboard::paste(cx);
    });
    wait_for_import(cx);
    let path = cx.update(|cx| {
        AppModels::global(cx)
            .queue()
            .read(cx)
            .item_at(0)
            .unwrap()
            .path
            .to_string()
    });
    cx.update(|cx| {
        cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(path.clone()));
        imgconvert_gpui_queue::clipboard::paste(cx);
    });
    while cx.dispatcher.tick(true) {}
    assert!(cx.dispatcher.tick(false));
    while cx.dispatcher.tick(true) {}
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-cancel-import", cx);
    })
    .unwrap();
    wait_for_import(cx);
    cx.run_until_parked();
    assert!(
        std::path::Path::new(&path).exists(),
        "cancelling a rescan must not delete an older bitmap"
    );
    cx.update(|cx| assert_eq!(AppModels::global(cx).queue().read(cx).len(), 1));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-clear", cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert!(!std::path::Path::new(&path).exists());
}

#[gpui_kit::test]
fn clipboard_partial_path_errors_are_visible_and_modals_do_not_import(cx: &mut TestAppContext) {
    use imgconvert_gpui_shared::queue_model::ImportFeedback;
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!(
        "imgconvert-clipboard-partial-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("photo.png");
    let spaced = dir.join("photo.png ");
    std::fs::write(&input, one_by_one_png()).unwrap();
    std::fs::write(&spaced, one_by_one_png()).unwrap();
    cx.update(|cx| {
        cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(
            spaced.to_str().unwrap().to_string(),
        ));
        imgconvert_gpui_queue::clipboard::paste(cx);
    });
    wait_for_import(cx);
    cx.update(|cx| {
        // The scanner's existing extension policy skips `.png `, but must
        // never import the different valid `.png` file by trimming its path.
        assert!(AppModels::global(cx).queue().read(cx).is_empty());
    });
    cx.update(|cx| {
        cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(format!(
            "{}\n{}",
            input.display(),
            dir.join("missing.png").display()
        )));
        imgconvert_gpui_queue::clipboard::paste(cx);
    });
    wait_for_import(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert_eq!(queue.len(), 1);
        assert_eq!(queue.item_at(0).unwrap().path.as_ref(), input.to_str().unwrap());
        assert!(matches!(queue.feedback(), ImportFeedback::Clipboard { added: 1, issues } if issues.iter().any(|issue| matches!(issue, imgconvert_gpui_shared::queue_model::ClipboardIssue::PathIssues { errors: 1, .. }))));
        cx.write_to_clipboard(clipboard_bitmap());
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        toggle_language(cx);
        window.render_frame(cx);
        assert!(
            window
                .find("queue-feedback")
                .value()
                .unwrap()
                .contains("1 个路径无法读取")
        );
        toggle_language(cx);
        window.render_frame(cx);
        window.click("plugin-diagnostics", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.has_active_dialog(cx));
        window.press("secondary-v", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert_eq!(queue.len(), 1);
        assert!(!queue.is_importing());
    });
    std::fs::remove_dir_all(dir).unwrap();
}

#[gpui_kit::test]
fn item_formats_menu_drives_mixed_outputs_and_reset(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, workspace) = open_workspace_sized(cx, size(px(760.), px(480.)));
    let dir = std::env::temp_dir().join(format!("imgconvert-s10-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("out")).unwrap();
    for name in ["one", "two"] {
        std::fs::write(dir.join(format!("{name}.png")), one_by_one_png()).unwrap();
    }
    cx.update(|cx| {
        let models = AppModels::global(cx).clone();
        models.queue().update(cx, |queue, cx| {
            queue.add_files(
                ["one", "two"]
                    .map(|name| imgconvert_backend::import::ImportScanFile {
                        path: dir
                            .join(format!("{name}.png"))
                            .to_string_lossy()
                            .into_owned(),
                        key: name.into(),
                        relative_dir: None,
                        metadata: None,
                    })
                    .to_vec(),
            );
            cx.notify();
        });
        models.settings().update(cx, |settings, cx| {
            settings.update(cx, |s| {
                s.format = "webp".into();
                s.result_cache = false;
            });
        });
        workspace
            .read(cx)
            .workflow()
            .clone()
            .update(cx, |workflow, cx| {
                workflow.set_output_dir(dir.join("out"), cx);
            });
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("item-format:one").visible());
        let row = window.find("one").bounds();
        let control = window.find("item-format:one").bounds();
        assert!(control.origin.x >= row.origin.x && control.right() <= row.right());
        assert!(control.origin.y >= row.origin.y && control.bottom() <= row.bottom());
        toggle_language(cx);
        let font = gpui_kit::component::Theme::global(cx).font_size;
        gpui_kit::component::Theme::update(cx, |theme| theme.font_size = font * 1.15);
        window.render_frame(cx);
        let row = window.find("one").bounds();
        let control = window.find("item-format:one").bounds();
        assert!(control.right() <= row.right() && control.bottom() <= row.bottom());
        assert!(
            window.find("queue-reset-formats").bounds().right()
                <= window.find("queue-drop-target").bounds().right()
        );
        gpui_kit::component::Theme::update(cx, |theme| theme.font_size = font);
        toggle_language(cx);
        window.render_frame(cx);
        AppModels::global(cx)
            .queue()
            .clone()
            .update(cx, |queue, cx| {
                queue.set_importing(true);
                cx.notify();
            });
        window.render_frame(cx);
        window.click("item-format:one", cx);
        assert!(window.try_find("popup-menu").is_none());
        AppModels::global(cx)
            .queue()
            .clone()
            .update(cx, |queue, cx| {
                queue.set_importing(false);
                cx.notify();
            });
        window.render_frame(cx);
        window.click("item-format:one", cx);
        window.render_frame(cx);
        let jpeg_ix = imgconvert_backend::convert::capabilities()
            .writable
            .iter()
            .position(|f| *f == "jpeg")
            .unwrap()
            + 2;
        window.within("popup-menu").click(jpeg_ix, cx);
        window.render_frame(cx);
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, cx| {
        let jpeg_ix = imgconvert_backend::convert::capabilities()
            .writable
            .iter()
            .position(|f| *f == "jpeg")
            .unwrap()
            + 2;
        window.click("item-format:one", cx);
        window.render_frame(cx);
        // The first Down selects Follow global; subsequent Down skips the separator.
        for _ in 0..jpeg_ix {
            window.within("popup-menu").press("down", cx);
        }
        assert_eq!(
            window.within("popup-menu").find(jpeg_ix).selected(),
            Some(true)
        );
        window.within("popup-menu").press("enter", cx);
        window.render_frame(cx);
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update(|cx| {
        let models = AppModels::global(cx);
        assert_eq!(
            models
                .queue()
                .read(cx)
                .item(&"one".into())
                .unwrap()
                .target_format
                .as_deref(),
            Some("jpeg")
        );
        assert_eq!(models.settings().read(cx).settings().format, "webp");
    });
    cx.update_window(handle, |_, window, cx| {
        let models = AppModels::global(cx).clone();
        let form = workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone();
        // AVIF globally, but every actual output is JPEG/WebP: target size is valid.
        models.queue().update(cx, |queue, cx| {
            queue.set_target_format(&"two".into(), Some("webp"));
            cx.notify();
        });
        models.settings().update(cx, |settings, cx| {
            settings.update(cx, |s| s.format = "avif".into());
        });
        form.update(cx, |form, cx| form.set_target_size_enabled(true, cx));
        assert!(models.settings().read(cx).settings().target_size_enabled);
        assert!(!form.read(cx).has_invalid_configuration(cx));
        // An unsupported per-item format must block Start despite a supported global one.
        models.settings().update(cx, |settings, cx| {
            settings.update(cx, |s| s.format = "jpeg".into());
        });
        models.queue().update(cx, |queue, cx| {
            queue.set_target_format(&"two".into(), Some("png"));
            cx.notify();
        });
        assert!(form.read(cx).has_invalid_configuration(cx));
        models.queue().update(cx, |queue, cx| {
            queue.set_target_format(&"two".into(), None);
            cx.notify();
        });
        form.update(cx, |form, cx| form.set_target_size_enabled(false, cx));
        models.settings().update(cx, |settings, cx| {
            settings.update(cx, |s| s.format = "webp".into());
        });
        window.render_frame(cx);
        window.click("item-format:one", cx);
        assert_eq!(window.find("popup-menu").focused(), Some(true));
        window.press("escape", cx);
        window.render_frame(cx);
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, cx| {
        window.click("workflow-start", cx);
    })
    .unwrap();
    wait_for_batch_to_settle(cx);
    assert!(dir.join("out/one_done.jpg").exists());
    assert!(dir.join("out/two_done.webp").exists());
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-reset-formats", cx);
        window.render_frame(cx);
    })
    .unwrap();
    cx.update(|cx| {
        assert!(
            AppModels::global(cx)
                .queue()
                .read(cx)
                .items()
                .iter()
                .all(|item| item.target_format.is_none() && item.status == ItemStatus::Pending)
        );
    });
    std::fs::remove_dir_all(dir).unwrap();
}

/// Copy through the real read-only document control, using the test platform's
/// clipboard. This never reads or overwrites the host's native clipboard.
fn copy_legal_document(cx: &mut TestAppContext, handle: gpui_kit::AnyWindowHandle) -> String {
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("legal-document", cx);
        window.press("secondary-a", cx);
        window.press("secondary-c", cx);
        cx.read_from_clipboard()
            .and_then(|item| item.text())
            .unwrap_or_default()
    })
    .unwrap()
}

#[gpui_kit::test]
fn legal_dialogs_focus_the_reading_control_on_open_and_restore_the_trigger(
    cx: &mut TestAppContext,
) {
    let _locale = locale_guard();
    let (handle, _) = open_workspace(cx);
    for (trigger, expected, expected_label) in [
        (
            "privacy-open",
            include_str!("../../../../../PRIVACY.en.md"),
            "Privacy and support",
        ),
        (
            "licenses-open",
            include_str!("../../../THIRD_PARTY_LICENSES.md"),
            "About and licenses",
        ),
    ] {
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            for _ in 0..40 {
                if window.find(trigger).focused() == Some(true) {
                    break;
                }
                window.press("tab", cx);
                window.render_frame(cx);
            }
            assert_eq!(window.find(trigger).focused(), Some(true));
            cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string("before opening".into()));
            window.press("enter", cx);
            window.render_frame(cx);
            assert!(window.has_active_dialog(cx));
            assert_eq!(
                window.find("legal-document").role(),
                Some(gpui_kit::Role::MultilineTextInput)
            );
            assert_eq!(window.find("legal-document").label(), Some(expected_label));
            assert_eq!(window.find("legal-document").focused(), Some(true));
            // No click or Tab to focus the body: opening owns initial focus.
            window.press("secondary-a", cx);
            window.press("secondary-c", cx);
            assert_eq!(
                cx.read_from_clipboard()
                    .and_then(|item| item.text())
                    .as_deref(),
                Some(expected)
            );
        })
        .unwrap();
        // Root action dispatch is deferred. End each platform event before
        // inspecting the resulting frame, as a native key event does.
        for (key, expected_document) in [("tab", false), ("shift-tab", true), ("shift-tab", false)]
        {
            cx.update_window(handle, |_, window, cx| window.press(key, cx))
                .unwrap();
            cx.update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                assert_eq!(
                    window.find("legal-document").focused(),
                    Some(expected_document)
                );
                let trap = gpui_kit::base::active_focus_trap(window, cx)
                    .expect("focus must stay inside the legal dialog");
                assert!(trap.contains_focused(window, cx));
            })
            .unwrap();
        }
        let first = cx
            .update_window(handle, |_, window, cx| window.focused(cx).unwrap())
            .unwrap();
        let mut visited = vec![first.clone()];
        let mut completed_cycle = false;
        for _ in 0..8 {
            cx.update_window(handle, |_, window, cx| window.press("shift-tab", cx))
                .unwrap();
            let focused = cx
                .update_window(handle, |_, window, cx| {
                    window.render_frame(cx);
                    assert!(gpui_kit::base::active_focus_trap(window, cx).is_some());
                    window.focused(cx).unwrap()
                })
                .unwrap();
            assert_ne!(visited.last(), Some(&focused), "reverse Tab must move");
            if focused == first {
                completed_cycle = true;
                break;
            }
            assert!(
                !visited.contains(&focused),
                "only the cycle start may repeat"
            );
            visited.push(focused);
        }
        assert!(completed_cycle, "reverse Tab must complete a modal cycle");
        assert_eq!(visited.len(), 4, "both close buttons, document and support");
        cx.update_window(handle, |_, window, cx| {
            window.press("escape", cx);
            window.render_frame(cx);
            assert!(!window.has_active_dialog(cx));
        })
        .unwrap();
        settle_animations(cx, handle);
        cx.update_window(handle, |_, window, _| {
            assert_eq!(window.find(trigger).focused(), Some(true));
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn privacy_policy_is_offline_readonly_localized_and_restores_focus(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _) = open_workspace_sized(cx, size(px(760.), px(480.)));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        for _ in 0..30 {
            if window.find("privacy-open").focused() == Some(true) {
                break;
            }
            window.press("tab", cx);
            window.render_frame(cx);
        }
        assert_eq!(window.find("privacy-open").focused(), Some(true));
        window.press("enter", cx);
        window.render_frame(cx);
        assert!(window.find("legal-dialog").visible());
        let document = window.find("legal-document").bounds();
        let close = window.find("legal-close").bounds();
        assert!(document.bottom() < close.origin.y);
        assert!(close.bottom() < window.viewport_size().height);
    })
    .unwrap();
    let english = include_str!("../../../../../PRIVACY.en.md");
    assert!(
        copy_legal_document(cx, handle) == english,
        "the entire English policy is available offline"
    );
    cx.update_window(handle, |_, window, cx| {
        window.input("must not replace the policy", cx);
        window.press("backspace", cx);
        window.press("secondary-v", cx);
    })
    .unwrap();
    assert!(
        copy_legal_document(cx, handle) == english,
        "editing and paste cannot change the policy"
    );
    assert!(
        cx.opened_url().is_none(),
        "opening a local document does not open a browser"
    );
    cx.update_window(handle, |_, window, cx| window.press("tab", cx))
        .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("enter", cx);
    })
    .unwrap();
    assert_eq!(
        cx.opened_url().as_deref(),
        Some("https://github.com/web-casa/ImgConvert/issues")
    );
    cx.update(toggle_language);
    cx.run_until_parked();
    assert!(copy_legal_document(cx, handle) == include_str!("../../../../../PRIVACY.md"));
    cx.update(|cx| assert!(AppModels::global(cx).queue().read(cx).is_empty()));
    cx.update_window(handle, |_, window, cx| {
        window.press("escape", cx);
        window.render_frame(cx);
        assert!(!window.has_active_dialog(cx));
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, _| {
        assert_eq!(window.find("privacy-open").focused(), Some(true));
    })
    .unwrap();
}

#[gpui_kit::test]
fn licenses_include_the_full_gpui_and_native_notices_and_remain_copyable(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("licenses-open", cx);
        window.render_frame(cx);
        assert!(window.find("legal-document").visible());
    })
    .unwrap();
    let expected = include_str!("../../../THIRD_PARTY_LICENSES.md");
    let copied = copy_legal_document(cx, handle);
    assert!(
        copied == expected,
        "copy includes the end of the complete license bundle"
    );
    for marker in [
        "gpui-kit@0.7.1",
        "gpui-pre@0.3.8",
        "LICENSE-LUCIDE",
        "libavif/LICENSE",
        "vendor/third_party/libyuv/LICENSE",
        "The Independent JPEG Group",
        "Project notice",
    ] {
        assert!(copied.contains(marker), "missing attribution: {marker}");
    }
    cx.update_window(handle, |_, window, cx| {
        window.press("end", cx);
        window.press("pagedown", cx);
        window.press("escape", cx);
        window.render_frame(cx);
        assert!(!window.has_active_dialog(cx));
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, cx| {
        window.click("licenses-open", cx);
        window.render_frame(cx);
        window.click("legal-close", cx);
        window.render_frame(cx);
        assert!(!window.has_active_dialog(cx));
    })
    .unwrap();
}

#[gpui_kit::test]
fn parity_scan_reports_failures_and_stop_preserves_existing_queue(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!("imgconvert-s12-scan-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("source.png");
    std::fs::write(&file, one_by_one_png()).unwrap();
    cx.update(|cx| {
        imgconvert_gpui_queue::import::import_paths(
            vec![file.clone(), dir.join("missing.png")],
            cx,
        );
    });
    wait_for_import(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let text = window.find("queue-feedback").value().unwrap().to_owned();
        assert!(
            text.contains("Added 1 files") && text.contains("1 paths couldn’t be read"),
            "{text}"
        );
        toggle_language(cx);
        window.render_frame(cx);
        assert!(
            window
                .find("queue-feedback")
                .value()
                .unwrap()
                .contains("1 个路径无法读取")
        );
        toggle_language(cx);
        let unseen = dir.join("unseen.png");
        std::fs::write(&unseen, one_by_one_png()).unwrap();
        imgconvert_gpui_queue::import::import_paths(vec![unseen], cx);
        // The worker has not run; Stop deterministically cancels this scan.
        window.render_frame(cx);
        window.click("queue-cancel-import", cx);
    })
    .unwrap();
    wait_for_import(cx);
    cx.update(|cx| assert_eq!(AppModels::global(cx).queue().read(cx).len(), 1));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(
            window
                .find("queue-feedback")
                .value()
                .unwrap()
                .contains("Added 0 files")
        );
    })
    .unwrap();
    std::fs::remove_dir_all(dir).unwrap();
}

#[gpui_kit::test]
fn parity_structured_errors_retranslate_and_remove_preserves_sources(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _) = open_workspace_sized(cx, size(px(760.), px(480.)));
    let key = gpui_kit::SharedString::from("parity-source");
    cx.update(|cx| {
        AppModels::global(cx)
            .queue()
            .clone()
            .update(cx, |queue, cx| {
                queue.add_files(vec![imgconvert_backend::import::ImportScanFile {
                    key: key.to_string(),
                    path: "/no-real-data/source.png".into(),
                    relative_dir: None,
                    metadata: Some(imgconvert_backend::import::ImportImageMetadata {
                        animation: imgconvert_backend::import::ImportAnimation::Static,
                        format: "png".into(),
                        width: 1,
                        height: 1,
                        dpi_x: None,
                        dpi_y: None,
                        page_count: None,
                    }),
                }]);
                queue.apply_batch_event(
                    &imgconvert_backend::convert::BatchProgressEvent::FileError {
                        index: 0,
                        input: "/no-real-data/source.png".into(),
                        error: imgconvert_backend::command_error::CommandError::file_not_found(
                            "/no-real-data/source.png",
                            "PRIVATE backend detail",
                        ),
                    },
                    std::slice::from_ref(&key),
                );
                cx.notify();
            });
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(
            window.find("status:parity-source").value(),
            Some("Failed · File not found: /no-real-data/source.png")
        );
        toggle_language(cx);
        window.render_frame(cx);
        assert_eq!(
            window.find("status:parity-source").value(),
            Some("失败 · 找不到文件：/no-real-data/source.png")
        );
        let row = window.find("parity-source").bounds();
        let remove = window.find("remove:parity-source").bounds();
        assert!(remove.right() <= row.right() && remove.bottom() <= row.bottom());
        window.click("remove:parity-source", cx);
        window.render_frame(cx);
        assert!(window.find("queue-empty").visible());
    })
    .unwrap();
    cx.update(|cx| assert!(AppModels::global(cx).queue().read(cx).is_empty()));
}

#[gpui_kit::test]
fn parity_pdf_import_metadata_and_source_format_menu(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _) = open_workspace(cx);
    cx.update(|cx| {
        AppModels::global(cx)
            .settings()
            .clone()
            .update(cx, |settings, cx| {
                settings.update(cx, |s| s.format = "png".into());
            });
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("workflow-format").value(), Some("PNG"));
    })
    .unwrap();
    let dir = std::env::temp_dir().join(format!("imgconvert-s12-pdf-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let pdf = dir.join("document.pdf");
    std::fs::write(&pdf, include_bytes!("fixtures/minimal.pdf")).unwrap();
    let png = dir.join("image.png");
    std::fs::write(&png, one_by_one_png()).unwrap();
    cx.update(|cx| imgconvert_gpui_queue::import::import_paths(vec![pdf.clone(), png.clone()], cx));
    wait_for_import(cx);
    let (pdf_key, png_key) = cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        let pdf_item = queue.items().iter().find(|item| item.is_pdf()).unwrap();
        assert_eq!(pdf_item.page_count, Some(1));
        assert_eq!(pdf_item.source_format.as_deref(), Some("pdf"));
        assert!(pdf_item.source_width.is_some() && pdf_item.source_height.is_some());
        let png_item = queue.items().iter().find(|item| !item.is_pdf()).unwrap();
        (pdf_item.key.clone(), png_item.key.clone())
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("workflow-format").value(), Some("PNG · Source"));
        toggle_language(cx);
        window.render_frame(cx);
        assert_eq!(window.find("workflow-format").value(), Some("PNG · 来源"));
        toggle_language(cx);
        window.render_frame(cx);
        let meta_id = gpui_kit::SharedString::from(format!("meta:{pdf_key}"));
        assert!(window.find(meta_id).value().unwrap().contains("PDF"));
        window.click(
            gpui_kit::SharedString::from(format!("item-format:{png_key}")),
            cx,
        );
        window.render_frame(cx);
        let png_ix = imgconvert_backend::convert::capabilities()
            .writable
            .iter()
            .position(|format| *format == "png")
            .unwrap()
            + 2;
        assert_eq!(
            window.within("popup-menu").find(png_ix).label(),
            Some("PNG · Source")
        );
        window.within("popup-menu").press("escape", cx);
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click(
            gpui_kit::SharedString::from(format!("remove:{png_key}")),
            cx,
        );
        window.render_frame(cx);
    })
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("workflow-format").value(), Some("PNG"));
    })
    .unwrap();
    assert!(
        png.exists() && pdf.exists(),
        "removing regular inputs must preserve originals"
    );
    cx.update(|cx| imgconvert_gpui_queue::import::import_paths(vec![png], cx));
    wait_for_import(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("workflow-format").value(), Some("PNG · Source"));
        window.click("queue-clear", cx);
    })
    .unwrap();
    // Queue observers run when the app update closes, before the next frame.
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("workflow-format").value(), Some("PNG"));
    })
    .unwrap();
    std::fs::remove_dir_all(dir).unwrap();
}

#[gpui_kit::test]
fn parity_remove_clipboard_item_cleans_only_its_registered_file(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, _) = open_workspace(cx);
    cx.update(|cx| cx.write_to_clipboard(clipboard_bitmap()));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("queue-paste", cx);
    })
    .unwrap();
    wait_for_import(cx);
    let (key, path) = cx.update(|cx| {
        let item = AppModels::global(cx).queue().read(cx).item_at(0).unwrap();
        (
            item.key.clone(),
            std::path::PathBuf::from(item.path.as_ref()),
        )
    });
    assert!(path.exists());
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click(gpui_kit::SharedString::from(format!("remove:{key}")), cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert!(!path.exists());
    cx.update(|cx| assert!(AppModels::global(cx).queue().read(cx).is_empty()));
}

#[gpui_kit::test]
fn parity_next_batch_keeps_completed_items_and_converts_only_new_inputs(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    let dir =
        std::env::temp_dir().join(format!("imgconvert-s12-next-batch-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("out")).unwrap();
    for name in ["first", "next"] {
        std::fs::write(dir.join(format!("{name}.png")), one_by_one_png()).unwrap();
    }
    let first = dir.join("first.png");
    cx.update(|cx| {
        AppModels::global(cx)
            .settings()
            .clone()
            .update(cx, |settings, cx| {
                settings.update(cx, |settings| {
                    settings.format = "png".into();
                    settings.result_cache = false;
                })
            });
        imgconvert_gpui_queue::import::import_paths(vec![first], cx);
    });
    wait_for_import(cx);
    let workflow = cx.update(|cx| workspace.read(cx).workflow().clone());
    cx.update(|cx| {
        workflow.update(cx, |panel, cx| {
            panel.start_with_output_dir(dir.join("out"), None, cx);
        });
    });
    wait_for_batch_to_settle(cx);
    let (first_key, status) = cx.update(|cx| {
        let item = AppModels::global(cx).queue().read(cx).item_at(0).unwrap();
        assert!(
            matches!(item.status, ItemStatus::Done { .. }),
            "{:?}",
            item.status
        );
        (item.key.clone(), item.status.clone())
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("workflow-start", cx);
        assert!(!progress_bridge::is_busy(cx));
    })
    .unwrap();
    cx.update(|cx| imgconvert_gpui_queue::import::import_paths(vec![dir.join("next.png")], cx));
    wait_for_import(cx);
    cx.update(|cx| {
        workflow.update(cx, |panel, cx| {
            panel.start_with_output_dir(dir.join("out"), None, cx);
        });
    });
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let models = AppModels::global(cx);
        assert_eq!(models.batch().read(cx).total(), 1);
        assert_eq!(
            models.queue().read(cx).item(&first_key).unwrap().status,
            status
        );
        assert!(matches!(
            models.queue().read(cx).item_at(1).unwrap().status,
            ItemStatus::Done { .. }
        ));
    });
    // A later job must not overwrite the original of an already completed
    // queue item, even when overwrite mode and self-overwrite are permitted.
    let original = std::fs::read(dir.join("first.png")).unwrap();
    std::fs::create_dir_all(dir.join("other")).unwrap();
    let collision = dir.join("other/first.png");
    std::fs::write(&collision, one_by_one_png()).unwrap();
    cx.update(|cx| {
        AppModels::global(cx)
            .settings()
            .clone()
            .update(cx, |settings, cx| {
                settings.update(cx, |s| {
                    s.output_suffix_enabled = false;
                    s.overwrite = imgconvert_backend::settings::OverwriteMode::Overwrite;
                });
            });
        imgconvert_gpui_queue::import::import_paths(vec![collision], cx);
    });
    wait_for_import(cx);
    cx.update(|cx| {
        workflow.update(cx, |panel, cx| {
            panel.start_with_output_dir(dir.clone(), None, cx);
        });
    });
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let models = AppModels::global(cx);
        assert_eq!(models.batch().read(cx).total(), 1);
        assert_eq!(models.batch().read(cx).failed(), 1);
        assert_eq!(models.queue().read(cx).item(&first_key).unwrap().status, status);
        assert!(matches!(&models.queue().read(cx).item_at(2).unwrap().status, ItemStatus::Error { error } if error.code == imgconvert_backend::command_error::ErrorCode::OutputConflictsWithInput));
    });
    assert_eq!(std::fs::read(dir.join("first.png")).unwrap(), original);
    std::fs::remove_dir_all(dir).unwrap();
}

#[gpui_kit::test]
fn animation_facts_mark_rows_and_count_pending_inputs_before_decode(cx: &mut TestAppContext) {
    use imgconvert_backend::import::ImportAnimation;
    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!("imgconvert-b2b-animation-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("out")).unwrap();
    std::fs::write(dir.join("static.png"), one_by_one_png()).unwrap();
    std::fs::write(
        dir.join("animated.png"),
        include_bytes!("fixtures/animated.png"),
    )
    .unwrap();
    std::fs::write(dir.join("prefix.png"), &one_by_one_png()[..33]).unwrap();
    cx.update(|cx| {
        imgconvert_gpui_queue::import::import_paths(
            vec![
                dir.join("static.png"),
                dir.join("animated.png"),
                dir.join("prefix.png"),
            ],
            cx,
        );
    });
    wait_for_import(cx);
    let (animated, unknown) = cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        assert_eq!(queue.animation_counts(), (1, 1));
        (
            queue
                .items()
                .iter()
                .find(|item| item.animation == ImportAnimation::Animated)
                .unwrap()
                .key
                .clone(),
            queue
                .items()
                .iter()
                .find(|item| item.animation == ImportAnimation::Unknown)
                .unwrap()
                .key
                .clone(),
        )
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(
            window
                .find("workflow-animation-check")
                .label()
                .unwrap()
                .contains("1 animated (unsupported) · 1 unverified")
        );
        assert!(
            window
                .find(gpui_kit::SharedString::from(format!("meta:{animated}")))
                .value()
                .unwrap()
                .contains("Animated · unsupported")
        );
        toggle_language(cx);
        window.render_frame(cx);
        assert!(
            window
                .find("workflow-animation-check")
                .label()
                .unwrap()
                .contains("1 个动画（暂不支持）")
        );
        assert!(
            window
                .find(gpui_kit::SharedString::from(format!("meta:{unknown}")))
                .value()
                .unwrap()
                .contains("动画状态未确认")
        );
    })
    .unwrap();
    let workflow = cx.update(|cx| workspace.read(cx).workflow().clone());
    cx.update(|cx| {
        AppModels::global(cx)
            .settings()
            .clone()
            .update(cx, |settings, cx| {
                settings.update(cx, |s| {
                    s.format = "png".into();
                    s.result_cache = false;
                });
            });
        workflow.update(cx, |panel, cx| {
            panel.start_with_output_dir(dir.join("out"), None, cx);
        });
    });
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let models = AppModels::global(cx);
        let queue = models.queue().read(cx);
        assert_eq!((models.batch().read(cx).completed(),models.batch().read(cx).failed()),(1,2));
        assert!(matches!(&queue.item(&animated).unwrap().status,ItemStatus::Error {error} if error.code == imgconvert_backend::command_error::ErrorCode::ConversionFailed && error.detail.as_deref().is_some_and(|detail| detail.contains("动画 PNG"))));
        assert!(matches!(&queue.item(&unknown).unwrap().status,ItemStatus::Error {error} if !error.detail.as_deref().is_some_and(|detail| detail.contains("动画 PNG"))));
    });
    std::fs::remove_dir_all(dir).unwrap();
}

#[gpui_kit::test]
fn precision_warnings_survive_queue_completion_and_retranslate(cx: &mut TestAppContext) {
    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!("imgconvert-b2b-precision-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("out")).unwrap();
    let source = dir.join("source.png");
    std::fs::write(&source, include_bytes!("fixtures/precision16.png")).unwrap();
    cx.update(|cx| imgconvert_gpui_queue::import::import_paths(vec![source], cx));
    wait_for_import(cx);
    let key = cx.update(|cx| {
        AppModels::global(cx)
            .queue()
            .read(cx)
            .item_at(0)
            .unwrap()
            .key
            .clone()
    });
    let workflow = cx.update(|cx| workspace.read(cx).workflow().clone());
    cx.update(|cx| {
        AppModels::global(cx)
            .settings()
            .clone()
            .update(cx, |settings, cx| {
                settings.update(cx, |s| {
                    s.format = "jpeg".into();
                    s.result_cache = false;
                });
            });
        workflow.update(cx, |panel, cx| {
            panel.start_with_output_dir(dir.join("out"), None, cx);
        });
    });
    wait_for_batch_to_settle(cx);
    cx.update(|cx| {
        let queue = AppModels::global(cx).queue().read(cx);
        let item = queue.item(&key).unwrap();
        assert!(matches!(item.status, ItemStatus::Done { .. }));
        assert!(item.warnings.contains(
            &imgconvert_backend::convert::ConvertWarning::BitDepthReduced { from: 16, to: 8 }
        ));
        assert!(
            item.warnings
                .contains(&imgconvert_backend::convert::ConvertWarning::AlphaFlattened)
        );
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let id = gpui_kit::SharedString::from(format!("status:{key}"));
        let text = window.find(id.clone()).value().unwrap().to_owned();
        assert!(
            text.contains("16-bit to 8-bit") && text.contains("opaque background"),
            "{text}"
        );
        toggle_language(cx);
        window.render_frame(cx);
        let text = window.find(id).value().unwrap().to_owned();
        assert!(
            text.contains("16 位降至 8 位") && text.contains("不透明背景"),
            "{text}"
        );
    })
    .unwrap();
    std::fs::remove_dir_all(dir).unwrap();
}

#[gpui_kit::test]
fn settings_controls_expose_native_names_roles_and_toggle_state(cx: &mut TestAppContext) {
    use imgconvert_gpui_shared::i18n::{Locale, tr};
    use imgconvert_gpui_workflow::Section;

    let _locale = locale_guard();
    let (handle, workspace) = open_workspace(cx);
    let form = cx.update(|cx| {
        workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone()
    });
    for locale in [Locale::English, Locale::SimplifiedChinese] {
        cx.update(|cx| {
            imgconvert_gpui_shared::i18n::set_locale(locale);
            cx.refresh_windows();
        });
        cx.update_window(handle, |_, window, cx| {
            form.update(cx, |form, cx| {
                form.set_format("jpeg", window, cx);
                form.set_open_section(None, cx);
            });
            window.render_frame(cx);
            for section in Section::ALL {
                let header = window.find(section.id());
                assert!(
                    header.label().is_some_and(|label| !label.is_empty()),
                    "{section:?}"
                );
                assert_eq!(header.checked(), Some(false));
            }
            assert_eq!(
                window.find(Section::Output.id()).label(),
                Some(tr("settings.output_section").as_ref())
            );
            let quality = window.find("settings-quality");
            assert_eq!(quality.role(), Some(gpui_kit::Role::Slider));
            assert_eq!(quality.label(), Some(tr("settings.quality").as_ref()));
            window.click("workflow-format", cx);
            window.render_frame(cx);
            let png_label = window.find("choice-label:png");
            assert_eq!(png_label.role(), Some(gpui_kit::Role::Label));
            assert_eq!(
                png_label.label(),
                None,
                "static text must not repeat its value as a title"
            );
            assert_eq!(png_label.value(), Some("PNG"));
            window.click("choice-label:png", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("workflow-format").value(), Some("PNG"));
            assert_eq!(
                AppModels::global(cx).settings().read(cx).settings().format,
                "png"
            );
            window.click("workflow-format", cx);
            window.render_frame(cx);
            window.press("up", cx);
            window.press("enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("workflow-format").value(), Some("JPEG"));
            assert_eq!(
                AppModels::global(cx).settings().read(cx).settings().format,
                "jpeg"
            );
            form.update(cx, |form, cx| {
                form.set_open_section(Some(Section::Output), cx);
            });
            window.render_frame(cx);
            assert_eq!(window.find(Section::Output.id()).checked(), Some(true));
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn quality_floor_keyboard_steps_cross_off_and_respect_limits_and_busy(cx: &mut TestAppContext) {
    use imgconvert_gpui_workflow::{Section, SliderKind};
    let _locale = locale_guard();
    let (handle, workspace) = open_workspace_sized(cx, size(px(1000.), px(2400.)));
    let form = cx.update(|cx| {
        workspace
            .read(cx)
            .workflow()
            .read(cx)
            .settings_form()
            .clone()
    });
    cx.update_window(handle, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.set_format("jpeg", window, cx);
            form.set_open_section(Some(Section::FormatParameters), cx);
            form.apply_slider(SliderKind::QualityFloor, 0., cx);
            form.focus_slider(SliderKind::QualityFloor, window, cx);
        });
    })
    .unwrap();
    settle_animations(cx, handle);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find(SliderKind::QualityFloor.id()).visible());
        for (key, expected) in [
            ("right", 30),
            ("right", 31),
            ("left", 30),
            ("left", 0),
            ("pageup", 30),
            ("home", 0),
            ("end", 100),
            ("right", 100),
            ("left", 99),
            ("home", 0),
            ("left", 0),
        ] {
            window.press(key, cx);
            assert_eq!(
                AppModels::global(cx)
                    .settings()
                    .read(cx)
                    .settings()
                    .jpeg_quality_floor,
                expected,
                "{key}"
            );
        }
        AppModels::global(cx)
            .queue()
            .clone()
            .update(cx, |queue, cx| {
                queue.set_importing(true);
                cx.notify();
            });
        form.update(cx, |form, cx| {
            form.apply_slider(SliderKind::QualityFloor, 31., cx);
        });
        window.render_frame(cx);
        window.press("right", cx);
        assert_eq!(
            AppModels::global(cx)
                .settings()
                .read(cx)
                .settings()
                .jpeg_quality_floor,
            0
        );
        AppModels::global(cx)
            .queue()
            .clone()
            .update(cx, |queue, cx| {
                queue.set_importing(false);
                cx.notify();
            });
    })
    .unwrap();
}

#[gpui_kit::test]
fn card_layout_keeps_actions_visible_and_shortcuts_preserve_settings(cx: &mut TestAppContext) {
    use gpui_kit::Focusable as _;
    use imgconvert_backend::settings::Theme;
    use imgconvert_gpui_workflow::Section;

    let _locale = locale_guard();
    let (handle, workspace) = open_workspace_sized(cx, size(px(1_280.), px(800.)));
    for (width, height, theme, locale) in [(760., 480.), (1_000., 640.), (1_280., 800.)]
        .into_iter()
        .flat_map(|(width, height)| {
            [Theme::Light, Theme::Dark]
                .into_iter()
                .flat_map(move |theme| {
                    [Locale::English, Locale::SimplifiedChinese]
                        .map(move |locale| (width, height, theme, locale))
                })
        })
    {
        cx.update(|cx| {
            AppModels::global(cx)
                .settings()
                .clone()
                .update(cx, |settings, cx| {
                    settings.update(cx, |settings| {
                        settings.theme = theme;
                        settings.locale = match locale {
                            Locale::English => AppLocale::EnUs,
                            Locale::SimplifiedChinese => AppLocale::ZhCn,
                        };
                        settings.format = if theme == Theme::Dark { "png" } else { "avif" }.into();
                    });
                });
            set_locale(locale);
        });
        cx.update_window(handle, |_, window, cx| {
            window.resize(size(px(width), px(height)));
            // The test platform resizes its bounds without the OS callback.
            window.bounds_changed(cx);
        })
        .unwrap();
        cx.run_until_parked();
        settle_animations(cx, handle);
        let before = cx.update(|cx| {
            let settings = AppModels::global(cx).settings().read(cx).settings();
            (settings.format.clone(), settings.quality, settings.theme)
        });
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let content = window.find("workspace-content").bounds();
            let footer = window.find("workflow-action-bar").bounds();
            assert!(
                content.bottom() <= footer.top(),
                "content must end above the footer"
            );
            assert!(
                footer.bottom() <= px(height),
                "footer {footer:?} at {width}x{height}"
            );
            for id in [
                "queue-add-files",
                "queue-add-folders",
                "queue-paste",
                "workflow-start",
            ] {
                let action = window.find(id);
                assert!(action.visible(), "{id} at {width}x{height}");
                let bounds = action.bounds();
                assert!(
                    bounds.left() >= px(0.) && bounds.right() <= px(width),
                    "{id}: {bounds:?}"
                );
                assert!(
                    bounds.top() >= px(0.) && bounds.bottom() <= px(height),
                    "{id}: {bounds:?}"
                );
                if id != "workflow-start" {
                    assert!(
                        bounds.top() >= content.top() && bounds.bottom() <= content.bottom(),
                        "{id} must stay inside the content, clear of the footer: {bounds:?}"
                    );
                }
            }
            window.click("nav-settings", cx);
        })
        .unwrap();
        settle_animations(cx, handle);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("nav-settings").checked(), Some(true));
            assert!(window.find("workflow-theme").visible());
            assert_eq!(window.find("workflow-theme").focused(), Some(true));
            let before_scroll = window.find("workflow-theme").bounds().origin;
            window.scroll(
                "workflow-scroll",
                gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(80.))),
                cx,
            );
            window.render_frame(cx);
            let after_scroll = window.find("workflow-theme").bounds().origin;
            assert_ne!(
                before_scroll, after_scroll,
                "manual scrolling must remain available"
            );
            window.render_frame(cx);
            assert_eq!(
                window.find("workflow-theme").bounds().origin,
                after_scroll,
                "navigation must not keep pinning the settings to the bottom"
            );

            assert_eq!(
                workspace
                    .read(cx)
                    .workflow()
                    .read(cx)
                    .settings_form()
                    .read(cx)
                    .open_section(),
                Some(Section::Appearance)
            );
            window.click("nav-convert", cx);
        })
        .unwrap();
        settle_animations(cx, handle);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("nav-convert").checked(), Some(true));
            assert!(window.find("settings-quality").visible());
            assert_eq!(window.find("workflow-format").focused(), Some(true));
            window.click("workflow-open-settings", cx);
        })
        .unwrap();
        settle_animations(cx, handle);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.find("workflow-theme").visible());
            window.click("nav-queue", cx);
            window.render_frame(cx);
            assert_eq!(window.find("nav-queue").checked(), Some(true));
            assert!(workspace.read(cx).focus_handle(cx).is_focused(window));
        })
        .unwrap();
        cx.update(|cx| {
            let settings = AppModels::global(cx).settings().read(cx).settings();
            assert_eq!(
                (settings.format.clone(), settings.quality, settings.theme),
                before
            );
            assert!(AppModels::global(cx).queue().read(cx).is_empty());
            assert!(!AppModels::global(cx).batch().read(cx).is_active());
        });
    }
}

#[gpui_kit::test]
fn card_navigation_preserves_a_nonempty_running_batch(cx: &mut TestAppContext) {
    use imgconvert_backend::progress::BatchId;
    let _locale = locale_guard();
    let (handle, _workspace) = open_workspace(cx);
    let dir = std::env::temp_dir().join(format!("imgconvert-cards-busy-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let source = dir.join("source.png");
    std::fs::write(&source, one_by_one_png()).unwrap();
    let (batch_before, settings_before) = cx.update(|cx| {
        let models = AppModels::global(cx).clone();
        models.queue().update(cx, |queue, cx| {
            queue.add_files(vec![imgconvert_backend::import::ImportScanFile {
                path: source.to_string_lossy().into_owned(),
                key: "card-source".into(),
                relative_dir: None,
                metadata: None,
            }]);
            cx.notify();
        });
        models.batch().update(cx, |batch, cx| {
            batch.begin(BatchId::new(919), vec!["card-source".into()]);
            cx.notify();
        });
        let settings = models.settings().read(cx).settings();
        (
            models.batch().read(cx).clone(),
            (settings.format.clone(), settings.quality, settings.theme),
        )
    });
    for id in [
        "nav-settings",
        "nav-convert",
        "nav-queue",
        "workflow-open-settings",
    ] {
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.find("workflow-cancel").visible());
            window.click(id, cx);
        })
        .unwrap();
        settle_animations(cx, handle);
        cx.update(|cx| {
            let models = AppModels::global(cx);
            assert_eq!(models.batch().read(cx), &batch_before);
            let queue = models.queue().read(cx);
            assert_eq!(queue.len(), 1);
            assert_eq!(queue.item_at(0).unwrap().key.as_ref(), "card-source");
            assert_eq!(queue.item_at(0).unwrap().status, ItemStatus::Pending);
            let settings = models.settings().read(cx).settings();
            assert_eq!(
                (settings.format.clone(), settings.quality, settings.theme),
                settings_before
            );
        });
    }
    cx.run_until_parked();
    assert_eq!(std::fs::read(&source).unwrap(), one_by_one_png());
    std::fs::remove_dir_all(dir).unwrap();
}

/// Semantic roles are necessary: a test-only label alone is not a native AX node.
#[gpui_kit::test]
fn queue_content_exposes_names_metadata_and_every_result_state(cx: &mut TestAppContext) {
    use gpui_kit::{Role, SharedString};
    use imgconvert_backend::command_error::CommandError;
    use imgconvert_backend::convert::{
        BatchProgressEvent, BatchProgressStage, ConvertResult, ConvertWarning,
    };
    use imgconvert_backend::import::{ImportAnimation, ImportImageMetadata, ImportScanFile};
    use imgconvert_gpui_shared::i18n::{tr, tr_with};

    let _locale = locale_guard();
    let (handle, _) = open_workspace(cx);
    let keys = [
        SharedString::from("readable-first"),
        SharedString::from("readable-second"),
    ];
    cx.update(|cx| {
        AppModels::global(cx)
            .queue()
            .clone()
            .update(cx, |queue, cx| {
                queue.add_files(
                    keys.iter()
                        .enumerate()
                        .map(|(index, key)| ImportScanFile {
                            key: key.to_string(),
                            path: format!("/no-real-data/photo-{index}.png"),
                            relative_dir: None,
                            metadata: Some(ImportImageMetadata {
                                animation: if index == 0 {
                                    ImportAnimation::Animated
                                } else {
                                    ImportAnimation::Unknown
                                },
                                format: "png".into(),
                                width: 2,
                                height: 3,
                                dpi_x: None,
                                dpi_y: None,
                                page_count: None,
                            }),
                        })
                        .collect(),
                );
                cx.notify();
            });
    });
    let failure =
        CommandError::file_not_found("/no-real-data/photo-0.png", "PRIVATE backend detail");
    let states = [
        (None, "status.pending", None),
        (
            Some(BatchProgressEvent::FileProgress {
                index: 0,
                percent: 42.,
                stage: BatchProgressStage::ReadingAndConverting,
            }),
            "status.running",
            Some("42%"),
        ),
        (
            Some(BatchProgressEvent::FileFinished {
                index: 0,
                result: ConvertResult {
                    input: "fixture".into(),
                    output: "fixture-output".into(),
                    in_size: 2048,
                    out_size: 1024,
                    environment_comparable: true,
                    warning: None,
                    warnings: vec![],
                    output_count: 1,
                    skipped_output_count: 0,
                },
            }),
            "status.done",
            Some("2.0 KB → 1.0 KB"),
        ),
        (
            Some(BatchProgressEvent::FileFinished {
                index: 0,
                result: ConvertResult {
                    input: "fixture".into(),
                    output: "fixture-output".into(),
                    in_size: 2048,
                    out_size: 1024,
                    environment_comparable: true,
                    warning: None,
                    warnings: vec![
                        ConvertWarning::BitDepthReduced { from: 16, to: 8 },
                        ConvertWarning::AlphaFlattened,
                    ],
                    output_count: 1,
                    skipped_output_count: 0,
                },
            }),
            "status.done",
            None,
        ),
        (
            Some(BatchProgressEvent::FileSkipped {
                index: 0,
                input: "fixture".into(),
                error: failure.clone(),
            }),
            "status.skipped",
            None,
        ),
        (
            Some(BatchProgressEvent::FileError {
                index: 0,
                input: "fixture".into(),
                error: failure,
            }),
            "status.error",
            None,
        ),
    ];
    for locale in [Locale::English, Locale::SimplifiedChinese] {
        cx.update(|cx| {
            set_locale(locale);
            cx.refresh_windows();
        });
        for (event, state_key, detail) in &states {
            cx.update(|cx| {
                AppModels::global(cx)
                    .queue()
                    .clone()
                    .update(cx, |queue, cx| {
                        queue.reset_statuses(&keys);
                        if let Some(event) = event {
                            queue.apply_batch_event(event, &keys);
                        }
                        cx.notify();
                    });
            });
            cx.update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                assert_eq!(window.find("queue-title").role(), Some(Role::Heading));
                assert_eq!(
                    window.find("queue-count").value(),
                    Some(tr_with("queue.item_count", &[("count", &2)]).as_ref())
                );
                for (index, key) in keys.iter().enumerate() {
                    let name = format!("photo-{index}.png");
                    assert_eq!(window.find(key.clone()).role(), Some(Role::Group));
                    let label = window.find(SharedString::from(format!("name:{key}")));
                    assert_eq!(label.role(), Some(Role::Label));
                    assert_eq!(label.value(), Some(name.as_str()));
                    assert_eq!(label.label(), None);
                    let metadata = window.find(SharedString::from(format!("meta:{key}")));
                    assert_eq!(metadata.role(), Some(Role::Label));
                    assert_eq!(metadata.label(), None);
                    assert!(metadata.value().unwrap().contains("PNG"));
                    let animation = if index == 0 {
                        "queue.animated"
                    } else {
                        "queue.animation_unknown"
                    };
                    assert!(
                        metadata.value().unwrap().contains(tr(animation).as_ref()),
                        "{metadata:?}"
                    );
                    assert_eq!(
                        window
                            .find(SharedString::from(format!("compare:{key}")))
                            .label(),
                        Some(tr_with("queue.compare_item", &[("name", &name)]).as_ref())
                    );
                }
                let state = window.find("status:readable-first");
                assert_eq!(
                    state.role(),
                    Some(if *state_key == "status.running" {
                        Role::Group
                    } else {
                        Role::Label
                    })
                );
                let message = if *state_key == "status.running" {
                    assert_eq!(state.value(), None);
                    state.label().unwrap()
                } else {
                    assert_eq!(state.label(), None, "avoid duplicate VoiceOver speech");
                    state.value().unwrap()
                };
                assert!(message.starts_with(tr(state_key).as_ref()), "{message}");
                assert!(!message.contains("PRIVATE"));
                if let Some(detail) = detail {
                    assert!(message.contains(detail), "{message}");
                }
                if *state_key == "status.done" {
                    assert_eq!(
                        window.find("impact:readable-first").label(),
                        Some(tr_with("queue.impact_item", &[("name", &"photo-0.png")]).as_ref())
                    );
                    if let Some(BatchProgressEvent::FileFinished { result, .. }) = event
                        && !result.warnings.is_empty()
                    {
                        assert!(
                            message.contains(if locale == Locale::English {
                                "16-bit to 8-bit"
                            } else {
                                "16 位降至 8 位"
                            }),
                            "{message}"
                        );
                        assert!(
                            message.contains(tr("warning.alpha_flattened").as_ref()),
                            "{message}"
                        );
                    }
                }
                assert_eq!(
                    window.find("status:readable-second").value(),
                    Some(tr("status.pending").as_ref())
                );
            })
            .unwrap();
        }
    }
}
