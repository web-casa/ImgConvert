// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Minimal shared-focus regression, also suitable for the upstream report.
use gpui_kit::component::button::Button;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AppContext as _, Context, FocusHandle, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, Styled as _, TestAppContext, Window, WindowOptions, div, px,
};

struct SharedFocus {
    focus: FocusHandle,
}
impl Render for SharedFocus {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .child(Button::new("before").label("Before"))
            .child(
                div().id("outer").track_focus(&self.focus).child(
                    div()
                        .id("inner")
                        .track_focus(&self.focus)
                        .h(px(30.))
                        .child("Shared focus"),
                ),
            )
            .child(Button::new("after").label("After"))
    }
}

#[gpui_kit::test]
fn reverse_tab_leaves_a_shared_focus_handle(cx: &mut TestAppContext) {
    let (handle, focus) = cx.update(|cx| {
        gpui_kit::init(cx);
        let (handle, view) = gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|cx| SharedFocus {
                focus: cx.focus_handle().tab_stop(true),
            })
        })
        .expect("open minimal fixture");
        (handle, view.read(cx).focus.clone())
    });
    cx.update_window(handle, |_, window, cx| {
        window.activate_window();
        window.render_frame(cx);
        window.focus(&focus, cx);
        window.render_frame(cx);
        window.press("tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("after").focused(), Some(true));
        window.press("shift-tab", cx);
        window.render_frame(cx);
        assert_eq!(window.focused(cx), Some(focus));
        window.press("shift-tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("before").focused(), Some(true));
    })
    .unwrap();
}

struct ReplayedFocus {
    focus: FocusHandle,
}

impl Render for ReplayedFocus {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .child(Button::new("before").label("Before"))
            .child(
                div().id("outer").track_focus(&self.focus).child(
                    div()
                        .id("inner")
                        .track_focus(&self.focus)
                        .h(px(30.))
                        .child("Shared focus"),
                ),
            )
            .child(Button::new("after").label("After"))
    }
}

#[gpui_kit::test]
fn replayed_frames_keep_one_shared_tab_stop(cx: &mut TestAppContext) {
    let (handle, focus) = cx.update(|cx| {
        gpui_kit::init(cx);
        let (handle, view) = gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|cx| ReplayedFocus {
                focus: cx.focus_handle().tab_stop(true),
            })
        })
        .expect("open replay fixture");
        (handle, view.read(cx).focus.clone())
    });
    cx.update_window(handle, |_, window, cx| {
        window.activate_window();
        // Cached paint replays register the same handles again every frame.
        for _ in 0..5 {
            window.render_frame(cx);
        }
        window.focus(&focus, cx);
        window.render_frame(cx);
        window.press("tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("after").focused(), Some(true));
        window.press("shift-tab", cx);
        window.render_frame(cx);
        assert_eq!(window.focused(cx), Some(focus));
        window.press("shift-tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("before").focused(), Some(true));
    })
    .unwrap();
}

struct ToggleFocus {
    focus: FocusHandle,
    tab_stop: bool,
}

impl Render for ToggleFocus {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let focus = self.focus.clone().tab_stop(self.tab_stop);
        div()
            .child(Button::new("before").label("Before"))
            .child(
                div()
                    .id("shared")
                    .track_focus(&focus)
                    .h(px(30.))
                    .child("Shared focus"),
            )
            .child(Button::new("after").label("After"))
    }
}

#[gpui_kit::test]
fn tab_stop_state_change_replaces_the_previous_registration(cx: &mut TestAppContext) {
    let (handle, view) = cx.update(|cx| {
        gpui_kit::init(cx);
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|cx| ToggleFocus {
                focus: cx.focus_handle().tab_stop(true),
                tab_stop: true,
            })
        })
        .expect("open toggle fixture")
    });
    let focus = view.read_with(cx, |view, _| view.focus.clone());
    cx.update_window(handle, |_, window, cx| {
        window.activate_window();
        window.render_frame(cx);
        window.focus(&focus, cx);
        window.render_frame(cx);
        window.press("tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("after").focused(), Some(true));
    })
    .unwrap();
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            view.tab_stop = false;
            cx.notify();
        });
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        // The focused shared node is no longer a tab stop; Shift-Tab must
        // skip its stale registration and reach the preceding control.
        window.press("shift-tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("before").focused(), Some(true));
    })
    .unwrap();
    cx.update(|cx| {
        view.update(cx, |view, cx| {
            view.tab_stop = true;
            cx.notify();
        });
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("tab", cx);
        window.render_frame(cx);
        assert_eq!(window.focused(cx), Some(focus));
    })
    .unwrap();
}
