// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Explicit macOS-only regression harness for the inactive IME patch candidate.
//! Run `cargo test --example g2_ime_focus_regression` in an isolated checkout
//! with the prepared patch config. The unpatched macOS baseline must fail.
//! Headless checks cover client state and undo, not the OS candidate popup.

fn main() {
    eprintln!(
        "Use cargo test --example g2_ime_focus_regression on macOS; see patches/gpui-ime-focus/README.md"
    );
}

#[cfg(all(test, target_os = "macos"))]
mod regression {
    use gpui_kit::component::{
        ActiveTheme as _, WindowExt as _,
        button::Button,
        input::{Input, InputState},
    };
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AppContext as _, Context, ElementInputHandler, Entity, EntityInputHandler as _,
        FocusHandle, Focusable as _, IntoElement, Keystroke, ParentElement as _, Render,
        StyleRefinement, Styled as _, TestAppContext, Window, WindowOptions, canvas, div, px,
    };

    use std::{cell::Cell, rc::Rc};

    struct Fixture {
        first: Entity<InputState>,
        second: Entity<InputState>,
        show_first: bool,
        readonly_second: bool,
        focus_second_on_render: bool,
        paint_roundtrip: bool,
        shared_client: usize,
        shared_focus: FocusHandle,
        render_count: Rc<Cell<usize>>,
    }
    impl Render for Fixture {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            self.render_count.set(self.render_count.get() + 1);
            let paint_roundtrip = std::mem::take(&mut self.paint_roundtrip);
            let first = self.first.clone();
            let second = self.second.clone();
            let first_focus = first.read(cx).focus_handle(cx);
            let second_focus = second.read(cx).focus_handle(cx);
            let shared_focus = self.shared_focus.clone();
            let shared_client = self.shared_client;
            if std::mem::take(&mut self.focus_second_on_render) {
                self.second.update(cx, |input, cx| input.focus(window, cx));
            }
            div()
                .size_full()
                .bg(cx.theme().background)
                .flex()
                .flex_col()
                .p_4()
                .gap_4()
                .children(self.show_first.then(|| Input::new(&self.first).id("first")))
                .child(
                    Input::new(&self.second)
                        .id("second")
                        .readonly(self.readonly_second),
                )
                .child(
                    Button::new("dialog")
                        .label("Open")
                        .on_click(|_, window, cx| {
                            window.open_dialog(cx, |dialog, _, _| {
                                dialog
                                    .title("Composition boundary")
                                    .child("No text input here")
                                    .footer(
                                        Button::new("candidate-close")
                                            .label("Close")
                                            .on_click(|_, window, cx| window.close_dialog(cx)),
                                    )
                            });
                        }),
                )
                .child(
                    canvas(
                        |_, _, _| {},
                        move |bounds, _, window, cx| {
                            if paint_roundtrip {
                                first.update(cx, |input, cx| input.focus(window, cx));
                                window.handle_input(
                                    &first_focus,
                                    ElementInputHandler::new(bounds, first.clone()),
                                    cx,
                                );
                                second.update(cx, |input, cx| input.focus(window, cx));
                                window.handle_input(
                                    &second_focus,
                                    ElementInputHandler::new(bounds, second.clone()),
                                    cx,
                                );
                                first.update(cx, |input, cx| input.focus(window, cx));
                            } else if shared_client != 0 {
                                let input = if shared_client == 1 {
                                    first.clone()
                                } else {
                                    second.clone()
                                };
                                window.handle_input(
                                    &shared_focus,
                                    ElementInputHandler::new(bounds, input),
                                    cx,
                                );
                            }
                        },
                    )
                    .size(px(1.)),
                )
        }
    }
    struct CachedFixture {
        child: Entity<Fixture>,
    }
    impl Render for CachedFixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            self.child
                .clone()
                .cached(StyleRefinement::default().w(px(640.)).h(px(480.)))
        }
    }
    fn open(cx: &mut TestAppContext) -> (gpui_kit::AnyWindowHandle, Entity<Fixture>) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            let (handle, root) =
                gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                    let child = cx.new(|cx| Fixture {
                        first: cx.new(|cx| InputState::new(window, cx)),
                        second: cx.new(|cx| InputState::new(window, cx)),
                        show_first: true,
                        readonly_second: false,
                        focus_second_on_render: false,
                        paint_roundtrip: false,
                        shared_client: 0,
                        shared_focus: cx.focus_handle(),
                        render_count: Rc::new(Cell::new(0)),
                    });
                    cx.new(|_| CachedFixture { child })
                })
                .expect("open fixture");
            (handle, root.read(cx).child.clone())
        })
    }
    fn compose(input: &Entity<InputState>, window: &mut Window, cx: &mut gpui_kit::App) {
        input.update(cx, |input, cx| {
            input.replace_and_mark_text_in_range(None, "ni hao", Some(6..6), window, cx)
        });
        window.render_frame(cx);
        assert!(
            input
                .update(cx, |input, cx| input.marked_text_range(window, cx))
                .is_some(),
            "precondition: a live marked range"
        );
    }
    fn marked(input: &Entity<InputState>, window: &mut Window, cx: &mut gpui_kit::App) -> bool {
        input
            .update(cx, |input, cx| input.marked_text_range(window, cx))
            .is_some()
    }
    #[gpui_kit::test]
    fn dialog_ends_previous_clients_marked_range(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            window.click("dialog", cx);
            window.render_frame(cx);
            assert!(
                !marked(&first, window, cx),
                "dialog must end the previous input client's composition"
            );
            assert!(window.find("candidate-close").visible());
            window.click("candidate-close", cx);
            window.click("first", cx);
            window.input("X", cx);
            assert_eq!(
                first.read(cx).value().as_ref(),
                "ni haoX",
                "new typing must not replace a stale marked range"
            );
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn text_to_text_clears_only_the_previous_client(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            let second = view.read(cx).second.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            window.click("second", cx);
            window.render_frame(cx);
            assert!(!marked(&first, window, cx));
            compose(&second, window, cx);
            assert!(!marked(&first, window, cx));
            assert!(marked(&second, window, cx));
            window.render_frame(cx);
            assert!(
                marked(&second, window, cx),
                "ordinary redraw must preserve current composition"
            );
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn same_frame_refocus_preserves_current_composition(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            let second = view.read(cx).second.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            second.update(cx, |input, cx| input.focus(window, cx));
            first.update(cx, |input, cx| input.focus(window, cx));
            window.render_frame(cx);
            assert!(
                marked(&first, window, cx),
                "no intervening frame may have installed a new client"
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn focus_changed_during_render_ends_previous_client(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            view.update(cx, |view, cx| {
                view.focus_second_on_render = true;
                cx.notify();
            });
            window.render_frame(cx);
            assert!(!marked(&first, window, cx));
            window.input("X", cx);
            assert_eq!(view.read(cx).second.read(cx).value().as_ref(), "X");
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn removing_current_input_ends_composition_without_explicit_blur(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            view.update(cx, |view, cx| {
                view.show_first = false;
                cx.notify();
            });
            window.render_frame(cx);
            assert!(!marked(&first, window, cx));
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn blur_commits_composition_as_a_separate_undo_transaction(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            window.blur(cx);
            window.render_frame(cx);
            assert!(!marked(&first, window, cx));
            window.click("first", cx);
            window.input("X", cx);
            window.press("cmd-z", cx);
            assert_eq!(first.read(cx).value().as_ref(), "ni hao");
            window.press("cmd-z", cx);
            assert_eq!(first.read(cx).value().as_ref(), "");
            window.press("cmd-shift-z", cx);
            assert_eq!(first.read(cx).value().as_ref(), "ni hao");
            assert!(!marked(&first, window, cx));
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn paint_roundtrip_selects_final_focused_client_without_cancelling_it(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            view.update(cx, |view, cx| {
                view.paint_roundtrip = true;
                cx.notify();
            });
            window.draw(cx).clear(cx);
            assert!(marked(&first, window, cx));
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            let mut key = Keystroke::parse("x").expect("valid keystroke");
            key.key_char = Some("X".into());
            assert!(window.dispatch_keystroke(key, cx));
            assert_eq!(view.read(cx).first.read(cx).value().as_ref(), "X");
            assert_eq!(view.read(cx).second.read(cx).value().as_ref(), "");
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn replacing_entity_behind_same_focus_clears_only_old_client(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            let shared_focus = view.read(cx).shared_focus.clone();
            shared_focus.focus(window, cx);
            view.update(cx, |view, cx| {
                view.shared_client = 1;
                cx.notify();
            });
            window.render_frame(cx);
            compose(&first, window, cx);
            view.update(cx, |view, cx| {
                view.shared_client = 2;
                cx.notify();
            });
            window.draw(cx).clear(cx);
            assert!(shared_focus.is_focused(window));
            assert!(!marked(&first, window, cx));
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            let mut key = Keystroke::parse("b").expect("valid keystroke");
            key.key_char = Some("B".into());
            assert!(window.dispatch_keystroke(key, cx));
            assert_eq!(view.read(cx).first.read(cx).value().as_ref(), "ni hao");
            assert_eq!(view.read(cx).second.read(cx).value().as_ref(), "B");
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn cached_paint_reuses_handler_without_ending_current_composition(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            let first = view.read(cx).first.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            window.draw(cx).clear(cx);
            window.draw(cx).clear(cx);
            let count = view.read(cx).render_count.get();
            window.draw(cx).clear(cx);
            assert_eq!(
                view.read(cx).render_count.get(),
                count,
                "cached subtree must not render again"
            );
            assert!(marked(&first, window, cx));
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            let mut key = Keystroke::parse("x").expect("valid keystroke");
            key.key_char = Some("X".into());
            assert!(window.dispatch_keystroke(key, cx));
            assert_eq!(view.read(cx).first.read(cx).value().as_ref(), "X");
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn readonly_text_client_ends_previous_composition(cx: &mut TestAppContext) {
        let (handle, view) = open(cx);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                view.readonly_second = true;
                cx.notify();
            });
            let first = view.read(cx).first.clone();
            window.render_frame(cx);
            window.click("first", cx);
            compose(&first, window, cx);
            window.click("second", cx);
            assert!(!marked(&first, window, cx));
            window.input("X", cx);
            assert_eq!(view.read(cx).second.read(cx).value().as_ref(), "");
        })
        .unwrap();
    }
}
