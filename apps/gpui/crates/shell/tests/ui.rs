// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! UI integration tests: the real workspace in a headless window.

use gpui_kit::test::TestWindowExt;
use gpui_kit::{AppContext, Bounds, TestAppContext, WindowBounds, WindowOptions, px, size};
use imgconvert_gpui::{Workspace, init_app, toggle_language};
use imgconvert_gpui_shared::i18n::{Locale, set_locale};
use imgconvert_gpui_shared::{AppModels, ItemStatus, progress_bridge};

fn open_workspace(
    cx: &mut TestAppContext,
) -> (gpui_kit::AnyWindowHandle, gpui_kit::Entity<Workspace>) {
    cx.update(|cx| {
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
    cx.update(toggle_language);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("queue-title").label(), Some("Queue"));
    })
    .unwrap();
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
    assert!(
        dir.join("out").join("one.webp").exists(),
        "expected one.webp in {:?}, found {produced:?}",
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
