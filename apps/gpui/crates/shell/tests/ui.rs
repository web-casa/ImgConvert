// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! UI integration tests: the real workspace in a headless window.

use gpui_kit::test::TestWindowExt;
use gpui_kit::{AppContext, Bounds, TestAppContext, WindowBounds, WindowOptions, px, size};
use imgconvert_backend::settings::{AppLocale, Settings};
use imgconvert_gpui::{Workspace, init_app, toggle_language};
use imgconvert_gpui_shared::i18n::{Locale, set_locale};
use imgconvert_gpui_shared::{AppModels, ItemStatus, SettingsModel, progress_bridge, services};

fn open_workspace(
    cx: &mut TestAppContext,
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
                    size(px(1_000.), px(640.)),
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
    let (handle, _workspace) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("queue-empty").visible());
        assert!(window.find("queue-empty-add").visible());
        assert!(window.find("workflow-start").visible());
        // Start on an empty queue is disabled: clicking must not start a batch.
        window.click("workflow-start", cx);
    })
    .unwrap();
    cx.update(|cx| {
        assert!(!AppModels::global(cx).batch().read(cx).is_active());
    });
}

#[gpui_kit::test]
fn language_toggle_rewrites_visible_labels(cx: &mut TestAppContext) {
    let (handle, _workspace) = open_workspace(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("queue-title").label(), Some("Queue"));
        window.click("language-toggle", cx);
        window.render_frame(cx);
        assert_eq!(window.find("queue-title").label(), Some("队列"));
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
        assert_eq!(window.find("queue-title").label(), Some("Queue"));
    })
    .unwrap();
    cx.update(|cx| {
        let settings = AppModels::global(cx).settings().read(cx);
        assert_eq!(settings.settings().locale, AppLocale::EnUs);
    });
}

#[gpui_kit::test]
fn persisted_format_and_folder_drive_the_panel_and_follow_its_edits(cx: &mut TestAppContext) {
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
fn settings_edits_coalesce_into_one_write_and_flush_on_demand(cx: &mut TestAppContext) {
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

    // A second batch right after the first: the handoff must not drop the
    // previous bridge early, and the existing output is skipped, not clobbered.
    cx.update_window(handle, |_, window, cx| {
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
