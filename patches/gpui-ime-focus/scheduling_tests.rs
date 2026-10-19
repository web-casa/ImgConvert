// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors
//! Observe within the update: test mode automatically draws at effect flush.
#![cfg(target_os = "macos")]

use gpui_kit::component::{
    ActiveTheme as _,
    input::{Input, InputState},
};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    AppContext as _, Context, Entity, EntityInputHandler as _, FocusHandle, Focusable as _,
    IntoElement, ParentElement as _, Render, Styled as _, TestAppContext, Window, WindowOptions,
    canvas, div, px,
};

struct Fixture {
    input: Entity<InputState>,
    late_focus: Option<FocusHandle>,
}
impl Render for Fixture {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let late = self.late_focus.take();
        div()
            .size_full()
            .bg(cx.theme().background)
            .child(Input::new(&self.input).id("composition"))
            .child(
                canvas(
                    |_, _, _| {},
                    move |_, _, window, cx| {
                        if let Some(focus) = &late {
                            focus.focus(window, cx);
                        }
                    },
                )
                .size(px(1.)),
            )
    }
}
fn open(cx: &mut TestAppContext) -> (gpui_kit::AnyWindowHandle, Entity<Fixture>) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
            cx.new(|cx| Fixture {
                input: cx.new(|cx| InputState::new(window, cx)),
                late_focus: None,
            })
        })
        .expect("open scheduling fixture")
    })
}
#[gpui_kit::test]
fn cleanup_wakes_followup_after_paint(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    let wakes = cx.frame_wake_observer(handle);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("composition", cx);
        let input = view.read(cx).input.clone();
        input.update(cx, |input, cx| {
            input.replace_and_mark_text_in_range(None, "ni hao", Some(6..6), window, cx)
        });
        window.render_frame(cx);
        window.blur(cx);
        let before = wakes();
        window.draw(cx).clear(cx);
        assert!(
            wakes() > before,
            "post-paint cleanup must wake its own followup before effect flush"
        );
        assert!(
            input
                .update(cx, |input, cx| input.marked_text_range(window, cx))
                .is_none()
        );
    })
    .unwrap();
}
#[gpui_kit::test]
fn first_late_focus_installs_client_on_next_frame(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    let wakes = cx.frame_wake_observer(handle);
    let installed = cx.text_input_handler_observer(handle);
    cx.update_window(handle, |_, window, cx| {
        window.blur(cx);
        window.draw(cx).clear(cx);
        assert!(!installed(), "precondition: no predecessor client");
        let focus = view.read(cx).input.read(cx).focus_handle(cx);
        view.update(cx, |view, cx| {
            view.late_focus = Some(focus);
            cx.notify();
        });
        let before = wakes();
        window.draw(cx).clear(cx);
        assert!(!installed(), "input painted before receiving focus");
        assert!(wakes() > before, "late first focus must schedule recovery");
        window.draw(cx).clear(cx);
        assert!(installed(), "next frame installs the late-focused client");
    })
    .unwrap();
}
#[gpui_kit::test]
fn permanently_missing_target_settles_after_one_recovery(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    let wakes = cx.frame_wake_observer(handle);
    let installed = cx.text_input_handler_observer(handle);
    cx.update_window(handle, |_, window, cx| {
        window.blur(cx);
        window.draw(cx).clear(cx);
        let missing = cx.focus_handle();
        view.update(cx, |view, cx| {
            view.late_focus = Some(missing);
            cx.notify();
        });
        let before = wakes();
        window.draw(cx).clear(cx);
        assert!(wakes() > before, "one recovery for the new missing target");
        let after_one = wakes();
        window.draw(cx).clear(cx);
        assert_eq!(
            wakes(),
            after_one,
            "missing target must settle before effect flush"
        );
        assert!(!installed());
    })
    .unwrap();
}
