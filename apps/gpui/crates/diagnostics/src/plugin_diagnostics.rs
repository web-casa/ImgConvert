// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The plugin diagnostics dialog (port of `PluginDiagnosticsDialog.svelte`):
//! HEIC status and active provider, a detection summary, the license and
//! channel boundary, system codecs, the manual helper (choose / clear),
//! system helpers and the manifest search directories.
//!
//! Probing (`codec_diagnostics`) and helper selection touch the file system
//! and PATH, so both run through `shared::tasks::run_blocking`. Choosing a
//! helper persists `heicHelperPath` the way the Svelte shell does: the
//! provider's resolved path when the helper is usable, else the path as
//! typed, so the diagnostic stays visible after a restart.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::spinner::Spinner;
use gpui_kit::component::{
    ActiveTheme as _, Icon, IconName, Sizable as _, WindowExt as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, Context, Div, Entity, FontWeight, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, SharedString, Styled as _, TestSupportExt as _, Window, div, px,
};
use imgconvert_backend::external_codecs::{
    self, CodecDiagnostics, CodecProviderDiagnostic, DiagnosticMessage, HeicCodecDiagnostics,
    ManifestDiagnostic, ManifestSearchDirDiagnostic, SelectedHelperDiagnostic,
    SystemCodecDiagnostic, SystemHelperDiagnostic,
};
use imgconvert_gpui_shared::a11y::DisabledForAll as _;
use imgconvert_gpui_shared::file_prompt::{self, PromptKind};
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::tasks;
use imgconvert_gpui_shared::theme::GlassStyled as _;
use imgconvert_gpui_shared::{AppModels, SettingsModel};

/// How a status chip reinforces its text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tone {
    Good,
    Neutral,
    Bad,
}

impl Tone {
    fn of(available: bool) -> Self {
        if available { Self::Good } else { Self::Neutral }
    }
}

/// Feedback under the manual-helper controls.
#[derive(Debug, Clone)]
enum ActionNotice {
    HelperEnabled,
    HelperUnavailable,
    HelperCleared,
    Diagnostic(DiagnosticMessage),
    SetFailed(String),
    ClearFailed(String),
}

pub struct PluginDiagnostics {
    settings: Entity<SettingsModel>,
    diagnostics: Option<CodecDiagnostics>,
    loading: bool,
    helper_busy: bool,
    load_error: Option<String>,
    notice: Option<ActionNotice>,
    request_id: u64,
    /// A refresh asked for while a probe was running; served when it ends.
    refresh_pending: bool,
}

impl PluginDiagnostics {
    fn new(cx: &mut Context<Self>) -> Self {
        let models = AppModels::global(cx).clone();
        Self {
            settings: models.settings().clone(),
            diagnostics: None,
            loading: false,
            helper_busy: false,
            load_error: None,
            notice: None,
            request_id: 0,
            refresh_pending: false,
        }
    }

    pub fn is_loading(&self) -> bool {
        self.loading
    }

    pub fn is_helper_busy(&self) -> bool {
        self.helper_busy
    }

    pub fn diagnostics(&self) -> Option<&CodecDiagnostics> {
        self.diagnostics.as_ref()
    }

    pub fn load_error(&self) -> Option<&str> {
        self.load_error.as_deref()
    }

    /// Probes again. While a probe is running the request is remembered and
    /// served when that probe ends, so a change made meanwhile is never
    /// shadowed by an older snapshot.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.loading {
            self.refresh_pending = true;
            return;
        }
        self.request_id += 1;
        let request_id = self.request_id;
        self.loading = true;
        self.load_error = None;
        cx.notify();
        let task = tasks::run_blocking(
            "imgconvert-diagnostics",
            cx,
            external_codecs::codec_diagnostics,
        );
        cx.spawn(async move |this, cx| {
            let outcome = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.request_id != request_id {
                    return;
                }
                this.loading = false;
                match outcome {
                    Ok(diagnostics) => this.diagnostics = Some(diagnostics),
                    Err(detail) => this.load_error = Some(detail),
                }
                cx.notify();
                if std::mem::take(&mut this.refresh_pending) {
                    this.refresh(cx);
                }
            });
        })
        .detach();
    }

    /// Opens the picker for a helper executable, then selects it.
    fn choose_helper(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.helper_busy {
            return;
        }
        let picker = file_prompt::prompt_paths(
            PromptKind::SingleFile,
            tr("diagnostics.choose_heic_helper"),
            cx,
        );
        cx.spawn_in(window, async move |this, cx| {
            if let Some(mut paths) = picker.await {
                let path = paths.remove(0).to_string_lossy().into_owned();
                let _ = this.update(cx, |this, cx| this.set_helper_path(Some(path), cx));
            }
        })
        .detach();
    }

    /// Selects (`Some`) or clears (`None`) the manual helper, persists the
    /// setting and probes again. Public for tests and future automation.
    pub fn set_helper_path(&mut self, path: Option<String>, cx: &mut Context<Self>) {
        if self.helper_busy {
            return;
        }
        self.helper_busy = true;
        self.notice = None;
        cx.notify();
        let clearing = path.is_none();
        let task = tasks::run_blocking("imgconvert-heic-helper", cx, move || {
            external_codecs::set_selected_heic_helper(path)
        });
        // The process-wide helper changes even if the dialog closes before
        // the worker ends, so the record is written through the settings
        // entity itself, not through this (possibly dropped) view.
        let settings = self.settings.clone();
        cx.spawn(async move |this, cx| {
            let outcome = task.await.and_then(|inner| inner);
            if let Ok(diagnostic) = &outcome {
                let persisted = diagnostic
                    .provider
                    .as_ref()
                    .map(|provider| provider.path.clone())
                    .or_else(|| diagnostic.path.clone());
                cx.update(|cx| {
                    settings.update(cx, |settings, cx| {
                        settings.update(cx, |s| s.heic_helper_path = persisted);
                    });
                });
            }
            let _ = this.update(cx, |this, cx| {
                this.helper_busy = false;
                match outcome {
                    Ok(diagnostic) => {
                        this.notice = Some(if clearing {
                            ActionNotice::HelperCleared
                        } else if diagnostic.available {
                            ActionNotice::HelperEnabled
                        } else if let Some(message) = diagnostic.message.clone() {
                            ActionNotice::Diagnostic(message)
                        } else {
                            ActionNotice::HelperUnavailable
                        });
                        this.refresh(cx);
                    }
                    Err(detail) => {
                        this.notice = Some(if clearing {
                            ActionNotice::ClearFailed(detail)
                        } else {
                            ActionNotice::SetFailed(detail)
                        });
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    // ---- rendering ----

    fn section(title: SharedString, cx: &App) -> Div {
        v_flex()
            .gap_2()
            .p_3()
            .rounded_lg()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(title),
            )
    }

    fn muted(text: SharedString, cx: &App) -> Div {
        div()
            .text_xs()
            .text_color(cx.theme().muted_foreground)
            .child(text)
    }

    /// Paths and arguments wrap instead of truncating: a diagnostics view
    /// must let the whole value be read.
    fn mono(text: SharedString, cx: &App) -> Div {
        div()
            .text_xs()
            .font_family("monospace")
            .text_color(cx.theme().muted_foreground)
            .min_w_0()
            .whitespace_normal()
            .child(text)
    }

    /// A small status chip whose meaning is carried by its text; color and
    /// the icon only reinforce it.
    fn chip(text: SharedString, tone: Tone, cx: &App) -> Div {
        let (color, icon) = match tone {
            Tone::Good => (cx.theme().success, Some(IconName::Check)),
            Tone::Neutral => (cx.theme().muted_foreground, None),
            Tone::Bad => (cx.theme().danger, Some(IconName::TriangleAlert)),
        };
        h_flex()
            .flex_none()
            .items_center()
            .gap_1()
            .px_1p5()
            .py_0p5()
            .rounded_sm()
            .border_1()
            .border_color(cx.theme().border)
            .text_xs()
            .text_color(color)
            .children(icon.map(|icon| Icon::new(icon).xsmall()))
            .child(text)
    }

    fn render_provider(provider: &CodecProviderDiagnostic, cx: &App) -> Div {
        let license = provider.license.clone().map_or_else(
            || match provider.kind.as_str() {
                "system-imageio" => tr("diagnostics.system_imageio"),
                "system-wic" => tr("diagnostics.windows_wic"),
                _ => tr("diagnostics.system_helper"),
            },
            SharedString::from,
        );
        let args: SharedString = if provider.args.is_empty() {
            tr("diagnostics.no_external_args")
        } else {
            provider.args.join(" ").into()
        };
        v_flex()
            .gap_1()
            .p_3()
            .rounded_md()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .child(provider.id.clone()),
            )
            .child(Self::muted(
                format!(
                    "{}: {}",
                    tr("diagnostics.type"),
                    provider_kind_text(&provider.kind)
                )
                .into(),
                cx,
            ))
            .child(Self::muted(
                format!("{}: {license}", tr("diagnostics.license")).into(),
                cx,
            ))
            .child(Self::muted(tr("diagnostics.executable"), cx))
            .child(Self::mono(provider.path.clone().into(), cx))
            .child(Self::muted(tr("diagnostics.argv"), cx))
            .child(Self::mono(args, cx))
    }

    fn render_status(&self, heic: &HeicCodecDiagnostics, cx: &App) -> Div {
        let title = if heic.enabled {
            tr("diagnostics.heic_enabled")
        } else {
            tr("diagnostics.heic_disabled")
        };
        let state = if heic.enabled {
            tr("diagnostics.active")
        } else {
            tr("diagnostics.inactive")
        };
        v_flex()
            .gap_2()
            .p_3()
            .rounded_lg()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                h_flex()
                    .justify_between()
                    .items_start()
                    .gap_3()
                    .child(
                        v_flex()
                            .min_w_0()
                            .gap_1()
                            .child(
                                div()
                                    .id("diagnostics-heic-state")
                                    .test_support()
                                    .text_sm()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(title),
                            )
                            .child(Self::muted(
                                tr_with(
                                    "diagnostics.extensions",
                                    &[("extensions", &heic.extensions.join(" / "))],
                                ),
                                cx,
                            ))
                            .children(
                                heic.disabled_reason
                                    .as_ref()
                                    .map(|reason| Self::muted(diagnostic_text(reason), cx)),
                            ),
                    )
                    .child(Self::chip(state, Tone::of(heic.enabled), cx)),
            )
            .child(match &heic.active_provider {
                Some(provider) => Self::render_provider(provider, cx),
                None => Self::muted(tr("diagnostics.no_provider"), cx),
            })
    }

    fn render_summary(heic: &HeicCodecDiagnostics, cx: &App) -> gpui_kit::AnyElement {
        let accepted = heic
            .manifest_dirs
            .iter()
            .flat_map(|dir| dir.manifests.iter())
            .filter(|manifest| manifest.status == "accepted")
            .count();
        let rejected = heic
            .manifest_dirs
            .iter()
            .flat_map(|dir| dir.manifests.iter())
            .filter(|manifest| manifest.status == "rejected")
            .count();
        let codecs = heic
            .system_codecs
            .iter()
            .filter(|codec| codec.available)
            .count();
        let helpers = heic
            .system_helpers
            .iter()
            .filter(|helper| helper.available)
            .count();
        let manual = if heic.selected_helper.available {
            tr("diagnostics.available")
        } else if heic.selected_helper.configured {
            tr("diagnostics.unavailable")
        } else {
            tr("diagnostics.not_configured")
        };
        let external = if heic.external_codecs_enabled {
            tr("diagnostics.enabled")
        } else {
            tr("diagnostics.disabled")
        };
        let stat = |label: SharedString, value: SharedString| {
            v_flex()
                .flex_1()
                .min_w_0()
                .gap_0p5()
                .px_3()
                .py_2()
                .rounded_md()
                .border_1()
                .border_color(cx.theme().border)
                .child(Self::muted(label, cx))
                .child(
                    div()
                        .text_sm()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(value),
                )
        };
        Self::section(tr("diagnostics.summary_title"), cx)
            .id("diagnostics-summary")
            .test_support()
            .child(
                h_flex()
                    .gap_2()
                    .child(stat(tr("diagnostics.external_codecs"), external))
                    .child(stat(tr("diagnostics.manual_helper"), manual))
                    .child(stat(
                        tr("diagnostics.accepted_manifests"),
                        accepted.to_string().into(),
                    )),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(stat(
                        tr("diagnostics.rejected_manifests"),
                        rejected.to_string().into(),
                    ))
                    .child(stat(
                        tr("diagnostics.system_codecs"),
                        codecs.to_string().into(),
                    ))
                    .child(stat(
                        tr("diagnostics.system_helpers"),
                        helpers.to_string().into(),
                    )),
            )
            .into_any_element()
    }

    fn render_system_codec(codec: &SystemCodecDiagnostic, cx: &App) -> Div {
        let found = if codec.available {
            tr("diagnostics.found")
        } else {
            tr("diagnostics.missing")
        };
        v_flex()
            .gap_1()
            .p_3()
            .rounded_md()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                h_flex()
                    .justify_between()
                    .gap_2()
                    .child(Self::mono(codec.id.clone().into(), cx))
                    .child(Self::chip(found, Tone::of(codec.available), cx)),
            )
            .child(Self::muted(diagnostic_text(&codec.message), cx))
            .children(
                codec
                    .install_hint
                    .as_ref()
                    .map(|hint| Self::muted(diagnostic_text(hint), cx)),
            )
            .child(Self::mono(
                format!(
                    "{} · {}",
                    provider_kind_text(&codec.kind),
                    codec.readable.join(" / ")
                )
                .into(),
                cx,
            ))
    }

    fn render_manual_helper(&self, heic: &HeicCodecDiagnostics, cx: &mut Context<Self>) -> Div {
        let selected: &SelectedHelperDiagnostic = &heic.selected_helper;
        let notice = self.notice.as_ref().map(|notice| match notice {
            ActionNotice::HelperEnabled => tr("diagnostics.manual_helper_enabled"),
            ActionNotice::HelperUnavailable => tr("diagnostics.manual_helper_unavailable"),
            ActionNotice::HelperCleared => tr("diagnostics.helper_cleared"),
            ActionNotice::Diagnostic(message) => diagnostic_text(message),
            ActionNotice::SetFailed(_detail) => tr("errors.codecConfigurationFailed"),
            ActionNotice::ClearFailed(_detail) => tr("errors.codecConfigurationFailed"),
        });
        Self::section(tr("diagnostics.manual_helper_title"), cx)
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("diagnostics-choose-helper")
                            .outline()
                            .small()
                            .label(tr("diagnostics.choose"))
                            .disabled_for_all(self.helper_busy || !heic.external_codecs_enabled)
                            .loading(self.helper_busy)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.choose_helper(window, cx)),
                            ),
                    )
                    .child(
                        Button::new("diagnostics-clear-helper")
                            .ghost()
                            .small()
                            .label(tr("diagnostics.clear"))
                            .disabled_for_all(self.helper_busy || !selected.configured)
                            .on_click(cx.listener(|this, _, _, cx| this.set_helper_path(None, cx))),
                    ),
            )
            .children(notice.map(|text| {
                div()
                    .id("diagnostics-helper-notice")
                    .test_support()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(text)
            }))
            .child(if selected.configured {
                let available = if selected.available {
                    tr("diagnostics.available")
                } else {
                    tr("diagnostics.unavailable")
                };
                v_flex()
                    .gap_1()
                    .p_3()
                    .rounded_md()
                    .border_1()
                    .border_color(cx.theme().border)
                    .child(
                        h_flex()
                            .justify_between()
                            .gap_2()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(available),
                            )
                            .child(Self::chip(
                                tr("diagnostics.selected"),
                                Tone::of(selected.available),
                                cx,
                            )),
                    )
                    .child(Self::mono(
                        selected.path.clone().unwrap_or_default().into(),
                        cx,
                    ))
                    .children(selected.message.as_ref().map(|message| {
                        div()
                            .text_xs()
                            .text_color(cx.theme().danger)
                            .child(diagnostic_text(message))
                    }))
            } else {
                Self::muted(tr("diagnostics.not_configured_helper"), cx)
            })
    }

    fn render_system_helper(helper: &SystemHelperDiagnostic, cx: &App) -> Div {
        let found = if helper.available {
            tr("diagnostics.found")
        } else {
            tr("diagnostics.missing")
        };
        let detail: SharedString = helper
            .path
            .clone()
            .map(SharedString::from)
            .or_else(|| helper.message.as_ref().map(diagnostic_text))
            .unwrap_or_default();
        v_flex()
            .gap_1()
            .p_3()
            .rounded_md()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                h_flex()
                    .justify_between()
                    .gap_2()
                    .child(Self::mono(helper.command.clone().into(), cx))
                    .child(Self::chip(found, Tone::of(helper.available), cx)),
            )
            .child(Self::mono(detail, cx))
    }

    fn render_manifest(manifest: &ManifestDiagnostic, cx: &App) -> Div {
        v_flex()
            .gap_1()
            .px_3()
            .py_2()
            .rounded_md()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                h_flex()
                    .justify_between()
                    .gap_2()
                    .child(Self::mono(manifest.path.clone().into(), cx))
                    .child(Self::chip(
                        status_text(&manifest.status),
                        status_tone(&manifest.status),
                        cx,
                    )),
            )
            .children(manifest.provider.as_ref().map(|provider| {
                Self::muted(
                    format!(
                        "{} · {}",
                        provider.id,
                        provider
                            .license
                            .clone()
                            .unwrap_or_else(|| tr("diagnostics.no_license").to_string())
                    )
                    .into(),
                    cx,
                )
            }))
            .children(manifest.message.as_ref().map(|message| {
                div()
                    .text_xs()
                    .text_color(cx.theme().danger)
                    .child(diagnostic_text(message))
            }))
    }

    fn render_manifest_dir(dir: &ManifestSearchDirDiagnostic, cx: &App) -> Div {
        v_flex()
            .gap_2()
            .p_3()
            .rounded_md()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                h_flex()
                    .gap_2()
                    .child(Self::chip(source_text(&dir.source), Tone::Neutral, cx))
                    .child(Self::chip(
                        status_text(&dir.status),
                        status_tone(&dir.status),
                        cx,
                    )),
            )
            .child(Self::mono(dir.path.clone().into(), cx))
            .children(
                dir.message
                    .as_ref()
                    .map(|message| Self::muted(diagnostic_text(message), cx)),
            )
            .children(
                dir.manifests
                    .iter()
                    .map(|manifest| Self::render_manifest(manifest, cx)),
            )
    }

    fn render_body(&self, cx: &mut Context<Self>) -> Div {
        if self.load_error.is_some() {
            return div()
                .text_sm()
                .text_color(cx.theme().danger)
                .child(tr("errors.taskFailed"));
        }
        let Some(diagnostics) = self.diagnostics.clone() else {
            return h_flex()
                .gap_2()
                .text_sm()
                .text_color(cx.theme().muted_foreground)
                .child(Spinner::new().small())
                .child(tr("diagnostics.loading"));
        };
        let heic = &diagnostics.heic;
        v_flex()
            .gap_3()
            .child(self.render_status(heic, cx))
            .child(Self::render_summary(heic, cx))
            .child(
                Self::section(tr("diagnostics.license_boundary_title"), cx)
                    .child(Self::muted(tr("diagnostics.license_boundary_body"), cx)),
            )
            .child(
                Self::section(tr("diagnostics.system_codecs_title"), cx).map(|section| {
                    if heic.system_codecs.is_empty() {
                        section.child(Self::muted(tr("diagnostics.no_system_codecs"), cx))
                    } else {
                        section.children(
                            heic.system_codecs
                                .iter()
                                .map(|codec| Self::render_system_codec(codec, cx)),
                        )
                    }
                }),
            )
            .child(self.render_manual_helper(heic, cx))
            .child(
                Self::section(tr("diagnostics.system_helpers_title"), cx).map(|section| {
                    if heic.system_helpers.is_empty() {
                        section.child(Self::muted(tr("diagnostics.no_system_helpers"), cx))
                    } else {
                        section.children(
                            heic.system_helpers
                                .iter()
                                .map(|helper| Self::render_system_helper(helper, cx)),
                        )
                    }
                }),
            )
            .child(
                Self::section(tr("diagnostics.manifest_search_title"), cx).map(|section| {
                    if heic.manifest_dirs.is_empty() {
                        section.child(Self::muted(tr("diagnostics.no_manifest_dirs"), cx))
                    } else {
                        section.children(
                            heic.manifest_dirs
                                .iter()
                                .map(|dir| Self::render_manifest_dir(dir, cx)),
                        )
                    }
                }),
            )
    }
}

impl Render for PluginDiagnostics {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let body_max_height = (window.viewport_size().height * 0.72).max(px(240.));
        v_flex()
            .id("plugin-diagnostics-body")
            .max_h(body_max_height)
            .overflow_y_scrollbar()
            .child(
                v_flex()
                    .id("plugin-diagnostics-view")
                    .test_support()
                    .gap_3()
                    .child(Self::muted(tr("diagnostics.description"), cx))
                    .child(self.render_body(cx)),
            )
    }
}

/// Opens the diagnostics dialog and starts the first probe.
pub fn open_plugin_diagnostics(window: &mut Window, cx: &mut App) -> Entity<PluginDiagnostics> {
    let view = cx.new(PluginDiagnostics::new);
    view.update(cx, PluginDiagnostics::refresh);
    let for_content = view.clone();
    window.open_dialog(cx, move |dialog, _, cx| {
        let content_entity = for_content.clone();
        let refresh_entity = for_content.clone();
        let loading = for_content.read(cx).is_loading();
        dialog
            .glass_dialog(cx)
            // The footer's own close button is the one way out besides
            // Escape: Kit's corner button is named "Close" in every language.
            .close_button(false)
            .title(tr("diagnostics.title"))
            .w(px(760.))
            .content(move |content, _, _| content.child(content_entity.clone()))
            .footer(
                h_flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        Button::new("diagnostics-refresh")
                            .outline()
                            .label(tr("diagnostics.refresh"))
                            .disabled_for_all(loading)
                            .on_click(move |_, _, cx| {
                                refresh_entity.update(cx, PluginDiagnostics::refresh);
                            }),
                    )
                    .child(
                        Button::new("diagnostics-close")
                            .label(tr("diagnostics.close"))
                            .on_click(|_, window, cx| window.close_dialog(cx)),
                    ),
            )
    });
    view
}

// ---- text helpers ----

/// Translates a backend diagnostic. Its `detail` (paths, host data) is shown
/// only in debug builds, as the Svelte shell does.
pub fn diagnostic_text(message: &DiagnosticMessage) -> SharedString {
    let detail: String = match &message.detail {
        Some(detail) if cfg!(debug_assertions) => detail.clone(),
        _ => tr("diagnostics.messages.details_hidden").to_string(),
    };
    let key = match message.code.as_str() {
        "externalCodecsBuildDisabled" => "diagnostics.messages.external_codecs_build_disabled",
        "externalCodecsBuildDisabledFlatpakEnabled" => {
            "diagnostics.messages.external_codecs_build_disabled_flatpak_enabled"
        }
        "externalCodecsEnvironmentDisabled" => {
            "diagnostics.messages.external_codecs_environment_disabled"
        }
        "externalCodecsEnvironmentDisabledFlatpakEnabled" => {
            "diagnostics.messages.external_codecs_environment_disabled_flatpak_enabled"
        }
        "externalCodecTrustUnsupported" => "diagnostics.messages.external_codec_trust_unsupported",
        "selectedHelperNotConfigured" => "diagnostics.messages.selected_helper_not_configured",
        "selectedHelperUnavailable" => "diagnostics.messages.selected_helper_unavailable",
        "directoryMissing" => "diagnostics.messages.directory_missing",
        "pathNotDirectory" => "diagnostics.messages.path_not_directory",
        "directoryUntrusted" => "diagnostics.messages.directory_untrusted",
        "manifestNotFound" => "diagnostics.messages.manifest_not_found",
        "directoryUnreadable" => "diagnostics.messages.directory_unreadable",
        "manifestRejected" => "diagnostics.messages.manifest_rejected",
        "pathEnvironmentMissing" => "diagnostics.messages.path_environment_missing",
        "helperNotFoundInTrustedPath" => "diagnostics.messages.helper_not_found_in_trusted_path",
        "wicUnsupportedPlatform" => "diagnostics.messages.wic_unsupported_platform",
        "wicAvailable" => "diagnostics.messages.wic_available",
        "wicMissing" => "diagnostics.messages.wic_missing",
        "wicProbeFailed" => "diagnostics.messages.wic_probe_failed",
        "windowsHeifInstallHint" => "diagnostics.messages.windows_heif_install_hint",
        _ => {
            return tr_with(
                "diagnostics.messages.unknown",
                &[("code", &message.code), ("detail", &detail)],
            );
        }
    };
    tr_with(key, &[("detail", &detail)])
}

fn provider_kind_text(kind: &str) -> SharedString {
    match kind {
        "manifest" => tr("diagnostics.provider_manifest"),
        "system-helper" => tr("diagnostics.system_helper"),
        "selected-helper" => tr("diagnostics.manual_helper"),
        "system-imageio" => tr("diagnostics.system_imageio"),
        "system-wic" => tr("diagnostics.windows_wic"),
        other => other.to_string().into(),
    }
}

fn source_text(source: &str) -> SharedString {
    match source {
        "explicit" => tr("diagnostics.source_explicit"),
        "platform" => tr("diagnostics.source_platform"),
        "flatpak-extension" => tr("diagnostics.source_flatpak_extension"),
        other => other.to_string().into(),
    }
}

fn status_text(status: &str) -> SharedString {
    match status {
        "accepted" => tr("diagnostics.status_accepted"),
        "ready" => tr("diagnostics.status_ready"),
        "rejected" => tr("diagnostics.status_rejected"),
        "missing" => tr("diagnostics.status_missing"),
        "empty" => tr("diagnostics.status_empty"),
        "untrusted" => tr("diagnostics.status_untrusted"),
        "unreadable" => tr("diagnostics.status_unreadable"),
        "notDirectory" => tr("diagnostics.status_not_directory"),
        "unsupported" => tr("diagnostics.status_unsupported"),
        "disabled" => tr("diagnostics.status_disabled"),
        other => other.to_string().into(),
    }
}

/// Healthy, failed or merely absent; the chip text always says which.
fn status_tone(status: &str) -> Tone {
    match status {
        "accepted" | "ready" => Tone::Good,
        "rejected" | "untrusted" | "unreadable" => Tone::Bad,
        _ => Tone::Neutral,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_tones_follow_the_svelte_mapping() {
        assert_eq!(status_tone("accepted"), Tone::Good);
        assert_eq!(status_tone("rejected"), Tone::Bad);
        assert_eq!(status_tone("missing"), Tone::Neutral);
        assert_eq!(Tone::of(false), Tone::Neutral);
    }
}
