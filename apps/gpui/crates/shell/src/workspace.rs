// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The main window (design "Clear Glass 2.0", 2026-10-22): a soft backdrop,
//! a header with the brand and a capsule of window-level commands, and two
//! glass panels. The queue panel is the primary region and carries the
//! floating action capsule with the one decision; the settings panel sits on
//! the trailing edge. Both panels are always present, so the earlier
//! navigation rail is gone; theme and reduced motion live in the header's
//! Appearance popover.

use crate::{OpenSettings, lifecycle};
use gpui_kit::component::button::{Button, ButtonRounded, ButtonVariants as _};
use gpui_kit::component::{
    ActiveTheme as _, IconName, Sizable as _, WindowExt as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    AnyWindowHandle, App, AppContext as _, Bounds, Context, Entity, FocusHandle, Focusable,
    FontWeight, Image, ImageFormat, ImageSource, InteractiveElement as _, IntoElement, ObjectFit,
    ParentElement as _, Render, Role, StatefulInteractiveElement as _, Styled as _,
    StyledImage as _, Subscription, TestSupportExt as _, TitlebarOptions, Window, WindowBounds,
    WindowOptions, div, img, px, rems, size,
};
use imgconvert_gpui_diagnostics::{PluginDiagnostics, open_plugin_diagnostics};
use imgconvert_gpui_impact::{ImpactSubject, ImpactView, open_environmental_impact};
use imgconvert_gpui_preview::{ComparisonPreview, open_comparison_preview};
use imgconvert_gpui_queue::{QueueView, QueueViewEvent};

use imgconvert_gpui_shared::i18n::tr;
use imgconvert_gpui_shared::theme::{self, ActiveGlass as _, GlassStyled as _};
use imgconvert_gpui_workflow::{ActionBar, ActionBarEvent, COMPACT_WIDTH_REM, WorkflowPanel};
use std::sync::{Arc, OnceLock};

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
        let focus_handle = cx.focus_handle();
        window.focus(&focus_handle, cx);
        Self {
            queue_view,
            workflow,
            action_bar,
            focus_handle,
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

    fn render_header(&self, compact: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let pill = ButtonRounded::Size(cx.theme().radius_full());
        h_flex()
            .id("workspace-header")
            .test_support()
            .h_12()
            .flex_none()
            .px_5()
            .gap_3()
            .items_center()
            // The brand mark is decoration: the title beside it names the app.
            .child(img(brand_mark()).size_7().flex_none())
            .child(
                div()
                    .id("workspace-title")
                    .test_support()
                    .role(Role::Heading)
                    .aria_label(tr("app.title"))
                    .text_base()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(tr("app.title")),
            )
            .child(div().flex_1())
            .child(
                h_flex()
                    .id("workspace-commands")
                    .test_support()
                    .flex_none()
                    .p_0p5()
                    .gap_0p5()
                    .items_center()
                    .glass_capsule(cx)
                    .child(
                        header_command(
                            "plugin-diagnostics",
                            IconName::Inspector,
                            "diagnostics.open",
                            compact,
                            pill,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.open_plugin_diagnostics(window, cx);
                        })),
                    )
                    .when(imgconvert_gpui_app_settings::is_visible(), |bar| {
                        bar.child(
                            header_command(
                                "updates-open",
                                IconName::RefreshCw,
                                "update.open",
                                compact,
                                pill,
                            )
                            .on_click(|_, window, cx| {
                                imgconvert_gpui_app_settings::open_updates(window, cx);
                            }),
                        )
                    })
                    .child(
                        header_command(
                            "privacy-open",
                            IconName::EyeOff,
                            "legal.privacy_open",
                            compact,
                            pill,
                        )
                        .on_click(|_, window, cx| {
                            imgconvert_gpui_app_settings::legal::open_privacy(window, cx);
                        }),
                    )
                    .child(
                        header_command(
                            "licenses-open",
                            IconName::Info,
                            "legal.licenses_open",
                            compact,
                            pill,
                        )
                        .on_click(|_, window, cx| {
                            imgconvert_gpui_app_settings::legal::open_licenses(window, cx);
                        }),
                    )
                    .child(crate::language::language_popover(compact, cx))
                    .child(crate::appearance::appearance_popover(cx)),
            )
    }
}

impl Focusable for Workspace {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for Workspace {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let compact = window.viewport_size().width < window.rem_size() * COMPACT_WIDTH_REM;
        div()
            .id("workspace")
            .test_support()
            // Root renders its dialogs outside this subtree. Keyboard trapping
            // alone does not prevent VO from walking the background controls.
            .when(window.has_active_dialog(cx), |workspace| {
                workspace
                    .role(Role::Group)
                    .a11y_synthetic_children(|builder| {
                        builder.parent_node().set_hidden();
                    })
            })
            .key_context("Workspace")
            .on_action(|_: &gpui_kit::component::input::Paste, window, cx| {
                // A read-only or disabled text field has no paste handler of
                // its own; Edit > Paste there must not import files.
                if window
                    .context_stack()
                    .iter()
                    .any(|context| context.contains("Input"))
                {
                    return;
                }
                imgconvert_gpui_queue::clipboard::paste(cx);
            })
            .on_action(cx.listener(|this, _: &OpenSettings, window, cx| {
                this.workflow.update(cx, |workflow, cx| {
                    workflow.focus_conversion_settings(window, cx);
                });
            }))
            .track_focus(&self.focus_handle)
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(
                img(ImageSource::Render(cx.glass().backdrop()))
                    .absolute()
                    .inset_0()
                    .size_full()
                    .object_fit(ObjectFit::Cover),
            )
            .child(
                v_flex()
                    .size_full()
                    .relative()
                    .child(self.render_header(compact, cx))
                    .child(
                        h_flex()
                            .id("workspace-content")
                            .test_support()
                            .flex_1()
                            .min_h_0()
                            .px_4()
                            .pb_4()
                            .gap_3()
                            .items_stretch()
                            .child(
                                v_flex()
                                    .id("workspace-queue-panel")
                                    .test_support()
                                    .flex_1()
                                    .min_w_0()
                                    .glass_panel(cx)
                                    .overflow_hidden()
                                    .child(div().flex_1().min_h_0().child(self.queue_view.clone()))
                                    // The capsule floats at the panel's foot;
                                    // the list ends above it, so no row hides
                                    // behind it.
                                    .child(div().flex_none().p_3().child(self.action_bar.clone())),
                            )
                            .child(
                                div()
                                    .id("workspace-settings-panel")
                                    .test_support()
                                    .w(if compact { rems(20.) } else { rems(23.) })
                                    .flex_none()
                                    .h_full()
                                    .glass_panel(cx)
                                    .overflow_hidden()
                                    .child(self.workflow.clone()),
                            ),
                    ),
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
        |window, cx| {
            window.on_window_should_close(cx, |_, cx| lifecycle::window_should_close(cx));
            cx.new(|cx| Workspace::new(window, cx))
        },
    )
    .inspect(|(handle, _)| lifecycle::set_main_window(*handle, cx))
}

/// The brand mark at title-bar size (`assets/brand/logo-mark-small.svg`), decoded once.
fn brand_mark() -> Arc<Image> {
    static MARK: OnceLock<Arc<Image>> = OnceLock::new();
    MARK.get_or_init(|| {
        Arc::new(Image::from_bytes(
            ImageFormat::Svg,
            include_bytes!("../../../../../assets/brand/logo-mark-small.svg").to_vec(),
        ))
    })
    .clone()
}

/// A header command: its name as the label, or below the compact width only
/// its icon, with the name on the tooltip and in the accessibility tree.
fn header_command(
    id: &'static str,
    icon: IconName,
    key: &str,
    compact: bool,
    pill: ButtonRounded,
) -> Button {
    let name = tr(key);
    let button = Button::new(id).ghost().small().rounded(pill);
    if compact {
        button
            .icon(icon)
            .accessibility_label(name.clone())
            .tooltip(name)
    } else {
        button.label(name)
    }
}
