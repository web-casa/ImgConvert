// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Accessibility actions on elements outside a scroll container's viewport.
//! GPUI performs a screen reader's "press" by synthesizing a mouse click at
//! the node; a node scrolled out of view must not click whatever is drawn at
//! its old position, and must be scrolled into view instead.
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AccessibleAction, AnyView, AnyWindowHandle, AppContext as _, Context, Entity,
    InteractiveElement as _, IntoElement, MouseButton, ParentElement as _, Render, Role,
    ScrollHandle, SharedString, StatefulInteractiveElement as _, StyleRefinement, Styled as _,
    TestAppContext, TestSupportExt as _, Window, WindowOptions, div, point, px,
};

const ROWS: usize = 30;
const HEADER: f32 = 40.;
const ROW: f32 = 40.;
/// Rows are wider than the window, so the vertical-only scroller has a
/// horizontal range it must never use.
const ROW_WIDTH: f32 = 4000.;

struct Fixture {
    scroll: ScrollHandle,
    header_clicks: usize,
    row_clicks: Vec<usize>,
    icon_clicks: usize,
    far_clicks: usize,
    grip_presses: usize,
}

impl Render for Fixture {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .id("header")
                    .test_support()
                    .role(Role::Button)
                    .aria_label("Header")
                    .h(px(HEADER))
                    .w_full()
                    .on_click(cx.listener(|this, _, _, _| this.header_clicks += 1)),
            )
            .child(
                div()
                    .id("scroller")
                    .test_support()
                    .h(px(200.))
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll)
                    .children((0..ROWS).map(|row| {
                        div()
                            .id(row_id(row))
                            .test_support()
                            .role(Role::Button)
                            .aria_label(row_id(row))
                            .relative()
                            .h(px(ROW))
                            .w(px(ROW_WIDTH))
                            .on_click(cx.listener(move |this, _, _, _| this.row_clicks[row] += 1))
                            // Row 0's middle is covered by its own command.
                            .when(row == 0, |this| {
                                this.child(
                                    div()
                                        .id("row-0-icon")
                                        .test_support()
                                        .role(Role::Button)
                                        .aria_label("Row 0 command")
                                        .absolute()
                                        .left(px(600.))
                                        .w(px(400.))
                                        .h_full()
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            cx.stop_propagation();
                                            this.icon_clicks += 1;
                                        })),
                                )
                            })
                            // Row 3's middle is covered by a grip that acts
                            // on mouse-down alone and keeps the press.
                            .when(row == 3, |this| {
                                this.child(
                                    div()
                                        .id("row-3-grip")
                                        .test_support()
                                        .absolute()
                                        .left(px(600.))
                                        .w(px(400.))
                                        .h_full()
                                        .on_mouse_down(
                                            MouseButton::Left,
                                            cx.listener(|this, _, _, cx| {
                                                cx.stop_propagation();
                                                this.grip_presses += 1;
                                            }),
                                        ),
                                )
                            })
                            // Row 1 has a control beyond the window's right edge.
                            .when(row == 1, |this| {
                                this.child(
                                    div()
                                        .id("row-1-far")
                                        .test_support()
                                        .role(Role::Button)
                                        .aria_label("Far")
                                        .absolute()
                                        .left(px(ROW_WIDTH - 200.))
                                        .w(px(100.))
                                        .h_full()
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            cx.stop_propagation();
                                            this.far_clicks += 1;
                                        })),
                                )
                            })
                    })),
            )
    }
}

fn row_id(row: usize) -> SharedString {
    SharedString::from(format!("row-{row}"))
}

fn open(cx: &mut TestAppContext) -> (AnyWindowHandle, gpui_kit::Entity<Fixture>) {
    let (handle, view) = cx.update(|cx| {
        gpui_kit::init(cx);
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| Fixture {
                scroll: ScrollHandle::new(),
                header_clicks: 0,
                row_clicks: vec![0; ROWS],
                icon_clicks: 0,
                far_clicks: 0,
                grip_presses: 0,
            })
        })
        .expect("open the fixture")
    });
    cx.update_window(handle, |_, window, cx| {
        window.activate_window();
        window.simulate_a11y_activation();
        window.render_frame(cx);
    })
    .unwrap();
    (handle, view)
}

/// Delivers the frames a deferred click waits for: one that applies the
/// scroll, then the one whose layout it hit-tests.
fn deliver_frames(window: &mut Window, cx: &mut gpui_kit::App) {
    window.simulate_next_frame(cx);
    window.render_frame(cx);
    window.simulate_next_frame(cx);
    window.render_frame(cx);
}

fn assert_inside_scroller(window: &Window, row: usize) {
    let viewport = window.find("scroller").bounds();
    let bounds = window.find(row_id(row)).bounds();
    assert!(
        bounds.top() >= viewport.top() && bounds.bottom() <= viewport.bottom(),
        "row {row} {bounds:?} must be inside the viewport {viewport:?}"
    );
}

#[gpui_kit::test]
fn press_on_a_visible_row_clicks_it_at_once(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        assert!(window.simulate_a11y_action(row_id(1), AccessibleAction::Click, cx));
    })
    .unwrap();
    cx.update(|cx| {
        let fixture = view.read(cx);
        assert_eq!(fixture.row_clicks[1], 1);
        assert_eq!(fixture.header_clicks, 0);
    });
}

#[gpui_kit::test]
fn press_on_a_row_scrolled_under_the_header_never_clicks_the_header(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    // Row 2 now sits exactly where the header is drawn, outside the
    // scroller's viewport.
    let scroll = cx.update(|cx| view.read(cx).scroll.clone());
    scroll.set_offset(point(px(0.), px(-(2. * ROW + HEADER))));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let header = window.find("header").bounds();
        assert_eq!(window.find(row_id(2)).bounds().top(), header.top());
        assert!(window.simulate_a11y_action(row_id(2), AccessibleAction::Click, cx));
        assert_eq!(
            view.read(cx).header_clicks,
            0,
            "a click at the row's stale position would land on the header"
        );
        deliver_frames(window, cx);
        assert_inside_scroller(window, 2);
    })
    .unwrap();
    cx.update(|cx| {
        let fixture = view.read(cx);
        assert_eq!(fixture.header_clicks, 0, "the header must not be clicked");
        assert_eq!(fixture.row_clicks[2], 1, "the row is clicked once visible");
    });
}

#[gpui_kit::test]
fn press_on_a_row_below_the_viewport_scrolls_it_in_and_clicks_it(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        assert!(window.simulate_a11y_action(row_id(12), AccessibleAction::Click, cx));
        deliver_frames(window, cx);
        assert_inside_scroller(window, 12);
    })
    .unwrap();
    cx.update(|cx| {
        let fixture = view.read(cx);
        assert_eq!(fixture.row_clicks[12], 1);
        assert_eq!(fixture.row_clicks.iter().sum::<usize>(), 1);
        assert_eq!(fixture.header_clicks, 0);
    });
}

#[gpui_kit::test]
fn scroll_into_view_reveals_a_row_without_clicking(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        assert!(window.simulate_a11y_action(row_id(25), AccessibleAction::ScrollIntoView, cx));
        window.render_frame(cx);
        assert_inside_scroller(window, 25);
        // Scrolling back up aligns the row's top with the viewport's.
        assert!(window.simulate_a11y_action(row_id(3), AccessibleAction::ScrollIntoView, cx));
        window.render_frame(cx);
        assert_eq!(
            window.find(row_id(3)).bounds().top(),
            window.find("scroller").bounds().top()
        );
    })
    .unwrap();
    cx.update(|cx| {
        let fixture = view.read(cx);
        assert_eq!(fixture.row_clicks.iter().sum::<usize>(), 0);
        assert_eq!(fixture.header_clicks, 0);
    });
}

#[gpui_kit::test]
fn press_avoids_a_clickable_child_covering_the_middle(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        let row = window.find(row_id(0)).bounds();
        let icon = window.find("row-0-icon").bounds();
        let viewport = window.find("scroller").bounds();
        let visible_middle = point(viewport.center().x, row.center().y);
        assert!(
            icon.contains(&visible_middle),
            "precondition: the command covers the middle"
        );
        assert!(window.simulate_a11y_action(row_id(0), AccessibleAction::Click, cx));
    })
    .unwrap();
    cx.update(|cx| {
        let fixture = view.read(cx);
        assert_eq!(fixture.row_clicks[0], 1, "the row itself is pressed");
        assert_eq!(fixture.icon_clicks, 0, "its command is not");
    });
}

#[gpui_kit::test]
fn a_vertical_scroller_never_moves_sideways(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        let left = window.find(row_id(0)).bounds().left();
        assert!(window.simulate_a11y_action("row-1-far", AccessibleAction::ScrollIntoView, cx));
        window.render_frame(cx);
        assert_eq!(window.find(row_id(0)).bounds().left(), left);
        // Out of reach sideways, the far control is not pressed at all, and
        // nothing else is pressed in its place.
        assert!(window.simulate_a11y_action("row-1-far", AccessibleAction::Click, cx));
        deliver_frames(window, cx);
        assert_eq!(window.find(row_id(0)).bounds().left(), left);
    })
    .unwrap();
    cx.update(|cx| {
        let fixture = view.read(cx);
        assert_eq!(fixture.far_clicks, 0);
        assert_eq!(fixture.row_clicks.iter().sum::<usize>(), 0);
    });
}

struct CachedOuter {
    inner: Entity<CachedInner>,
}

impl Render for CachedOuter {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .child(AnyView::from(self.inner.clone()).cached(StyleRefinement::default().size_full()))
    }
}

struct CachedInner {
    clicks: usize,
}

impl Render for CachedInner {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(
            div()
                .id("cached-button")
                .test_support()
                .role(Role::Button)
                .aria_label("Cached")
                .size(px(100.))
                .on_click(cx.listener(|this, _, _, _| this.clicks += 1)),
        )
    }
}

#[gpui_kit::test]
fn a_cached_view_keeps_its_nodes_while_assistive_technology_is_active(cx: &mut TestAppContext) {
    let (handle, outer) = cx.update(|cx| {
        gpui_kit::init(cx);
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            let inner = cx.new(|_| CachedInner { clicks: 0 });
            cx.new(|_| CachedOuter { inner })
        })
        .expect("open the fixture")
    });
    let inner = cx.update(|cx| outer.read(cx).inner.clone());
    cx.update_window(handle, |_, window, cx| {
        window.simulate_a11y_activation();
        window.render_frame(cx);
        // Redraw the outer view only: the inner one is clean and cached.
        outer.update(cx, |_, cx| cx.notify());
        window.draw(cx).clear(cx);
        assert!(
            window.simulate_a11y_action("cached-button", AccessibleAction::Click, cx),
            "the cached subtree's node is still in the tree"
        );
    })
    .unwrap();
    cx.update(|cx| assert_eq!(inner.read(cx).clicks, 1));
}

#[gpui_kit::test]
fn press_avoids_a_mouse_down_handler_covering_the_middle(cx: &mut TestAppContext) {
    let (handle, view) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        let row = window.find(row_id(3)).bounds();
        let grip = window.find("row-3-grip").bounds();
        let viewport = window.find("scroller").bounds();
        let visible_middle = point(viewport.center().x, row.center().y);
        assert!(
            grip.contains(&visible_middle),
            "precondition: the grip covers the middle"
        );
        assert!(window.simulate_a11y_action(row_id(3), AccessibleAction::Click, cx));
    })
    .unwrap();
    cx.update(|cx| {
        let fixture = view.read(cx);
        assert_eq!(fixture.row_clicks[3], 1, "the row itself is pressed");
        assert_eq!(fixture.grip_presses, 0, "the grip does not take the press");
    });
}
