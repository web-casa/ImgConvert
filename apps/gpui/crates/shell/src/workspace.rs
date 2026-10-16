// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The main window: a single-workspace shell with a thin toolbar, the queue
//! as the primary region and the workflow panel on the trailing edge.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{ActiveTheme as _, IconName, Sizable as _, h_flex, v_flex};
use gpui_kit::{
    AnyWindowHandle, App, AppContext as _, Bounds, Context, Entity, FocusHandle, Focusable,
    FontWeight, InteractiveElement as _, IntoElement, ParentElement as _, Render, Styled as _,
    TestSupportExt as _, TitlebarOptions, Window, WindowBounds, WindowOptions, div, px, size,
};
use imgconvert_gpui_queue::QueueView;
use imgconvert_gpui_shared::i18n::tr;
use imgconvert_gpui_workflow::WorkflowPanel;

use crate::toggle_language;

pub struct Workspace {
    queue_view: Entity<QueueView>,
    workflow: Entity<WorkflowPanel>,
    focus_handle: FocusHandle,
}

impl Workspace {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let queue_view = cx.new(QueueView::new);
        let workflow = cx.new(|cx| WorkflowPanel::new(window, cx));
        Self {
            queue_view,
            workflow,
            focus_handle: cx.focus_handle(),
        }
    }

    pub fn queue_view(&self) -> &Entity<QueueView> {
        &self.queue_view
    }

    pub fn workflow(&self) -> &Entity<WorkflowPanel> {
        &self.workflow
    }

    fn render_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex()
            .h_10()
            .px_4()
            .gap_2()
            .border_b_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().title_bar)
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(tr("app.title")),
            )
            .child(div().flex_1())
            .child(
                Button::new("language-toggle")
                    .ghost()
                    .small()
                    .icon(IconName::Globe)
                    .label(tr("app.language_toggle"))
                    .tooltip(tr("app.language_toggle_tooltip"))
                    // Same command as the `ToggleLanguage` action and menu item.
                    .on_click(|_, _, cx| toggle_language(cx)),
            )
    }
}

impl Focusable for Workspace {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for Workspace {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex()
            .id("workspace")
            .test_support()
            .key_context("Workspace")
            .track_focus(&self.focus_handle)
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(self.render_toolbar(cx))
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .items_stretch()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .child(self.queue_view.clone()),
                    )
                    .child(self.workflow.clone()),
            )
    }
}

/// Opens the main window at a comfortable default size.
pub fn open_main_window(cx: &mut App) -> gpui_kit::Result<(AnyWindowHandle, Entity<Workspace>)> {
    let bounds = Bounds::centered(None, size(px(1_080.), px(720.)), cx);
    gpui_kit::open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(TitlebarOptions {
                title: Some(tr("app.title")),
                ..Default::default()
            }),
            window_min_size: Some(size(px(760.), px(480.))),
            app_id: Some("io.github.yeagoo.imgconvert".into()),
            ..Default::default()
        },
        cx,
        |window, cx| cx.new(|cx| Workspace::new(window, cx)),
    )
}
