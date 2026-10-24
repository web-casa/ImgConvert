// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The window shown instead of the workspace when another ImgConvert version
//! holds the instance marker (plan §3.5: the Tauri 0.3.x line and this shell
//! never run at the same time because the Tauri store cannot take part in a
//! file-lock protocol).

use gpui_kit::component::alert::Alert;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{ActiveTheme as _, h_flex, v_flex};
use gpui_kit::{
    AnyWindowHandle, App, AppContext as _, Bounds, Context, FocusHandle, Focusable,
    InteractiveElement as _, IntoElement, ParentElement as _, Render, Styled as _,
    TestSupportExt as _, TitlebarOptions, Window, WindowBounds, WindowOptions, px, size,
};
use imgconvert_backend::instance_lock::InstanceInfo;
use imgconvert_gpui_shared::i18n::{tr, tr_with};

use crate::{Quit, lifecycle};

pub struct BlockedView {
    /// `None` when the marker could not be read (Windows blocks readers of
    /// an exclusively locked file).
    other: Option<InstanceInfo>,
    focus_handle: FocusHandle,
}

impl BlockedView {
    pub fn new(other: Option<InstanceInfo>, cx: &mut Context<Self>) -> Self {
        Self {
            other,
            focus_handle: cx.focus_handle(),
        }
    }
}

impl Focusable for BlockedView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for BlockedView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let detail = match &self.other {
            Some(other) => tr_with(
                "app.instance_blocked",
                &[("version", &other.version), ("pid", &other.pid)],
            ),
            None => tr("app.instance_blocked_unknown"),
        };
        v_flex()
            .id("instance-blocked")
            .test_support()
            .track_focus(&self.focus_handle)
            .size_full()
            .p_6()
            .gap_4()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(
                Alert::warning("instance-blocked-alert", detail)
                    .title(tr("app.instance_blocked_title")),
            )
            .child(div_spacer())
            .child(
                h_flex().justify_end().child(
                    Button::new("instance-blocked-quit")
                        .primary()
                        .label(tr("app.quit"))
                        .on_click(|_, window, cx| window.dispatch_action(Box::new(Quit), cx)),
                ),
            )
    }
}

fn div_spacer() -> impl IntoElement {
    gpui_kit::div().flex_1()
}

/// Opens the blocked window; the only way out is Quit.
pub fn open_blocked_window(
    other: Option<InstanceInfo>,
    cx: &mut App,
) -> gpui_kit::Result<AnyWindowHandle> {
    let bounds = Bounds::centered(None, size(px(480.), px(220.)), cx);
    let (handle, _view) = gpui_kit::open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(TitlebarOptions {
                title: Some(tr("app.title")),
                ..Default::default()
            }),
            is_resizable: false,
            app_id: Some("io.github.yeagoo.imgconvert".into()),
            ..Default::default()
        },
        cx,
        |window, cx| {
            window.on_window_should_close(cx, |_, cx| lifecycle::window_should_close(cx));
            cx.new(|cx| BlockedView::new(other, cx))
        },
    )?;
    Ok(handle)
}
