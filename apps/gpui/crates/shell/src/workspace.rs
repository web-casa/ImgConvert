// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The main window: a soft backdrop, a thin toolbar, the queue card as the
//! primary region, the settings card on the trailing edge and the floating
//! action bar with the one decision (design: "Liquid Glass", 2026-10-18).

use gpui_kit::component::button::{Button, ButtonRounded, ButtonVariants as _};
use gpui_kit::component::{ActiveTheme as _, IconName, Sizable as _, h_flex, v_flex};
use gpui_kit::{
    AnyWindowHandle, App, AppContext as _, Bounds, Context, Entity, FocusHandle, Focusable,
    FontWeight, ImageSource, InteractiveElement as _, IntoElement, ObjectFit, ParentElement as _,
    Render, Styled as _, StyledImage as _, Subscription, TestSupportExt as _, TitlebarOptions,
    Window, WindowBounds, WindowOptions, div, img, px, size,
};
use imgconvert_gpui_diagnostics::{PluginDiagnostics, open_plugin_diagnostics};
use imgconvert_gpui_impact::{ImpactSubject, ImpactView, open_environmental_impact};
use imgconvert_gpui_preview::{ComparisonPreview, open_comparison_preview};
use imgconvert_gpui_queue::{QueueView, QueueViewEvent};
use imgconvert_gpui_shared::i18n::tr;
use imgconvert_gpui_shared::theme::{self, ActiveGlass as _, GlassStyled as _};
use imgconvert_gpui_workflow::{ActionBar, ActionBarEvent, WorkflowPanel};

use crate::toggle_language;

pub struct Workspace {
    queue_view: Entity<QueueView>,
    workflow: Entity<WorkflowPanel>,
    action_bar: Entity<ActionBar>,
    focus_handle: FocusHandle,
    /// The dialog owns the preview; this only lets tests and menus find it.
    comparison_preview: Option<gpui_kit::WeakEntity<ComparisonPreview>>,
    plugin_diagnostics: Option<gpui_kit::WeakEntity<PluginDiagnostics>>,
    environmental_impact: Option<gpui_kit::WeakEntity<ImpactView>>,
    _subscriptions: Vec<Subscription>,
}

impl Workspace {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let queue_view = cx.new(QueueView::new);
        let workflow = cx.new(|cx| WorkflowPanel::new(window, cx));
        let action_bar = cx.new(|cx| ActionBar::new(workflow.clone(), cx));
        let subscriptions = vec![
            // Queue rows issue commands other features fulfil; the shell routes them.
            cx.subscribe_in(
                &queue_view,
                window,
                |this, _, event: &QueueViewEvent, window, cx| match event {
                    QueueViewEvent::ComparePreview(key) => {
                        this.open_comparison_preview(key.clone(), window, cx);
                    }
                    QueueViewEvent::EnvironmentalImpact(key) => {
                        this.open_environmental_impact(
                            ImpactSubject::Item(key.clone()),
                            window,
                            cx,
                        );
                    }
                },
            ),
            cx.subscribe_in(
                &action_bar,
                window,
                |this, _, event: &ActionBarEvent, window, cx| match event {
                    ActionBarEvent::BatchImpact => {
                        this.open_environmental_impact(ImpactSubject::Batch, window, cx);
                    }
                },
            ),
            // "Follow system" needs the window's appearance, which only the
            // window reports.
            window.observe_window_appearance(|window, cx| theme::apply(Some(window), cx)),
        ];
        theme::apply(Some(window), cx);
        Self {
            queue_view,
            workflow,
            action_bar,
            focus_handle: cx.focus_handle(),
            comparison_preview: None,
            plugin_diagnostics: None,
            environmental_impact: None,
            _subscriptions: subscriptions,
        }
    }

    /// Opens the before/after dialog for a queue item (what the row's
    /// Compare button does).
    pub fn open_comparison_preview(
        &mut self,
        key: gpui_kit::SharedString,
        window: &mut Window,
        cx: &mut App,
    ) -> Option<Entity<ComparisonPreview>> {
        let preview = open_comparison_preview(key, window, cx)?;
        self.comparison_preview = Some(preview.downgrade());
        Some(preview)
    }

    /// The comparison preview currently shown, if its dialog is still open.
    pub fn comparison_preview(&self) -> Option<Entity<ComparisonPreview>> {
        self.comparison_preview
            .as_ref()
            .and_then(gpui_kit::WeakEntity::upgrade)
    }

    /// Opens the plugin diagnostics dialog (the toolbar command).
    pub fn open_plugin_diagnostics(
        &mut self,
        window: &mut Window,
        cx: &mut App,
    ) -> Entity<PluginDiagnostics> {
        let view = open_plugin_diagnostics(window, cx);
        self.plugin_diagnostics = Some(view.downgrade());
        view
    }

    /// The diagnostics view currently shown, if its dialog is still open.
    pub fn plugin_diagnostics(&self) -> Option<Entity<PluginDiagnostics>> {
        self.plugin_diagnostics
            .as_ref()
            .and_then(gpui_kit::WeakEntity::upgrade)
    }

    /// Opens the storage and environmental scenario dialog (a row's
    /// Scenario button or the action bar's batch command).
    pub fn open_environmental_impact(
        &mut self,
        subject: ImpactSubject,
        window: &mut Window,
        cx: &mut App,
    ) -> Entity<ImpactView> {
        let view = open_environmental_impact(subject, window, cx);
        self.environmental_impact = Some(view.downgrade());
        view
    }

    /// The scenario view currently shown, if its dialog is still open.
    pub fn environmental_impact(&self) -> Option<Entity<ImpactView>> {
        self.environmental_impact
            .as_ref()
            .and_then(gpui_kit::WeakEntity::upgrade)
    }

    pub fn queue_view(&self) -> &Entity<QueueView> {
        &self.queue_view
    }

    pub fn workflow(&self) -> &Entity<WorkflowPanel> {
        &self.workflow
    }

    pub fn action_bar(&self) -> &Entity<ActionBar> {
        &self.action_bar
    }

    fn render_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let pill = ButtonRounded::Size(cx.theme().radius_full());
        h_flex()
            .h_12()
            .flex_none()
            .px_4()
            .gap_2()
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::BOLD)
                    .child(tr("app.title")),
            )
            .child(div().flex_1())
            .child(
                Button::new("plugin-diagnostics")
                    .ghost()
                    .small()
                    .rounded(pill)
                    .label(tr("diagnostics.open"))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.open_plugin_diagnostics(window, cx);
                    })),
            )
            .child(
                Button::new("language-toggle")
                    .ghost()
                    .small()
                    .rounded(pill)
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
        div()
            .id("workspace")
            .test_support()
            .key_context("Workspace")
            .track_focus(&self.focus_handle)
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            // The soft light behind the glass; it scales to any window size.
            .child(
                img(ImageSource::Render(cx.glass().backdrop()))
                    .absolute()
                    .inset_0()
                    .size_full()
                    .object_fit(ObjectFit::Cover),
            )
            .child(
                v_flex()
                    .absolute()
                    .inset_0()
                    .size_full()
                    .child(self.render_toolbar(cx))
                    .child(
                        h_flex()
                            .flex_1()
                            .min_h_0()
                            .px_3()
                            .pb_3()
                            .gap_3()
                            .items_stretch()
                            .child(
                                // Rows scroll under the card's rounded corners.
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .h_full()
                                    .glass_panel(cx)
                                    .overflow_hidden()
                                    .child(self.queue_view.clone()),
                            )
                            .child(
                                // The settings card ends above the floating bar.
                                div()
                                    .w_96()
                                    .flex_none()
                                    .h_full()
                                    .pb(theme::ACTION_BAR_CLEARANCE)
                                    .child(
                                        div()
                                            .size_full()
                                            .glass_panel(cx)
                                            .overflow_hidden()
                                            .child(self.workflow.clone()),
                                    ),
                            ),
                    ),
            )
            // Floats over the queue; the wrapper has no hitbox of its own.
            .child(
                h_flex()
                    .absolute()
                    .left_0()
                    .right_0()
                    .bottom_0()
                    .pb(theme::ACTION_BAR_MARGIN)
                    .justify_center()
                    .child(self.action_bar.clone()),
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
