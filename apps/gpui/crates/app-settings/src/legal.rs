// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Offline documents owned by app-settings. Text stays selectable and copyable;
//! opening a document never starts a request or accesses user files.

use gpui_kit::base::Link;
use gpui_kit::component::button::Button;
use gpui_kit::component::input::{IndentInline, OutdentInline, Textarea, TextareaState};
use gpui_kit::component::{ActiveTheme as _, WindowExt as _, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, Context, Entity, Focusable as _, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, Role, SharedString, StatefulInteractiveElement as _, Styled as _,
    TestSupportExt as _, Window, div,
};
use gpui_kit::{Global, KeyBinding};
use imgconvert_gpui_shared::a11y::dialog_title;
use imgconvert_gpui_shared::i18n::{Locale, tr, tr_with};
use imgconvert_gpui_shared::theme::GlassStyled as _;

gpui_kit::actions!(imgconvert_legal, [OpenSupport]);

struct LegalKeymap;
impl Global for LegalKeymap {}
const SUPPORT_URL: &str = "https://github.com/web-casa/ImgConvert/issues";

fn install_keymap(cx: &mut App) {
    if cx.has_global::<LegalKeymap>() {
        return;
    }
    // Dialog binds Enter to Confirm. Give its external link a nearer command
    // context so activating support cannot confirm or close the dialog.
    cx.bind_keys([
        KeyBinding::new("enter", OpenSupport, Some("LegalSupport")),
        KeyBinding::new("space", OpenSupport, Some("LegalSupport")),
    ]);
    cx.set_global(LegalKeymap);
}

const PRIVACY_ENGLISH: &str = include_str!("../../../../../PRIVACY.en.md");
const PRIVACY_CHINESE: &str = include_str!("../../../../../PRIVACY.md");
const LICENSES: &str = include_str!("../../../THIRD_PARTY_LICENSES.md");

#[derive(Clone, Copy)]
enum DocumentKind {
    Privacy,
    Licenses,
}

impl DocumentKind {
    fn text(self, locale: Locale) -> &'static str {
        match self {
            // The policy is written in English and Chinese; Chinese readers
            // of either script get the Chinese text, everyone else English.
            Self::Privacy => match locale {
                Locale::SimplifiedChinese | Locale::TraditionalChinese => PRIVACY_CHINESE,
                _ => PRIVACY_ENGLISH,
            },
            Self::Licenses => LICENSES,
        }
    }

    fn title(self) -> SharedString {
        tr(match self {
            Self::Privacy => "legal.privacy_title",
            Self::Licenses => "legal.licenses_title",
        })
    }
}

pub struct LegalDialog {
    kind: DocumentKind,
    document: Entity<TextareaState>,
    locale: Locale,
}

impl LegalDialog {
    fn new(kind: DocumentKind, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let locale = Locale::current();
        let document = cx.new(|cx| TextareaState::new(window, cx).default_value(kind.text(locale)));
        Self {
            kind,
            document,
            locale,
        }
    }

    fn sync_locale(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let locale = Locale::current();
        if self.locale == locale {
            return;
        }
        self.locale = locale;
        if matches!(self.kind, DocumentKind::Privacy) {
            self.document.update(cx, |state, cx| {
                state.set_value(self.kind.text(locale), window, cx);
            });
        }
    }

    /// The exact bundled document retained by the read-only control.
    pub fn text(&self, cx: &App) -> SharedString {
        self.document.read(cx).value()
    }
}

impl Render for LegalDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_locale(window, cx);
        // Resolved window geometry bounds the reading surface at the minimum
        // window size, while rem bounds its comfortable size and follows zoom.
        let ring = cx.theme().ring;
        let height = (window.viewport_size().height * 0.45).min(window.rem_size() * 24.);
        let document_focus = self.document.focus_handle(cx);
        let accessible_value = window.is_a11y_active().then(|| self.text(cx));
        let synthetic_value = accessible_value.clone();
        v_flex()
            .id("legal-dialog")
            .test_support()
            .min_w_0()
            .gap_3()
            .child(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child(match self.kind {
                        DocumentKind::Privacy => tr("legal.offline_policy"),
                        DocumentKind::Licenses => {
                            tr_with("legal.version", &[("version", &env!("CARGO_PKG_VERSION"))])
                        }
                    }),
            )
            .child(
                div()
                    .id("legal-document")
                    .test_support()
                    // Kit 0.7.1 paints the textarea frame and its editor as
                    // separate nodes. The wrapper carries the single announced
                    // text node bound to the editor's real keyboard focus; the
                    // inner textarea is presentational, and the wrapper is
                    // explicitly read-only. Input behavior is unchanged.
                    .role(Role::MultilineTextInput)
                    .track_focus(&document_focus)
                    .aria_label(self.kind.title())
                    .when_some(accessible_value, |document, value| {
                        document.aria_value(value)
                    })
                    // VoiceOver treats a value-only read-only text node as
                    // empty. Expose the document as a synthetic text run so
                    // its characters and UTF-8 offsets are available for
                    // speech without making the field editable.
                    .a11y_synthetic_children(move |builder| {
                        builder.parent_node().set_read_only();
                        let Some(value) = synthetic_value else {
                            return;
                        };
                        let mut run = gpui_kit::accesskit::Node::new(Role::TextRun);
                        run.set_value(value.to_string());
                        run.set_character_lengths(
                            value
                                .chars()
                                .map(|c| c.len_utf8() as u8)
                                .collect::<Vec<_>>(),
                        );
                        let id = builder.synthetic_node_id(0);
                        builder.push_child(id, run);
                    })
                    // The input context binds Tab to indentation even when
                    // read-only. Route those actions to normal dialog traversal.
                    .on_action(|_: &IndentInline, window, cx| {
                        if let Ok(action) = cx.build_action("root::Tab", None) {
                            window.dispatch_action(action, cx);
                        } else {
                            window.focus_next(cx);
                        }
                    })
                    .on_action(|_: &OutdentInline, window, cx| {
                        if let Ok(action) = cx.build_action("root::TabPrev", None) {
                            window.dispatch_action(action, cx);
                        } else {
                            window.focus_prev(cx);
                        }
                    })
                    .child(
                        Textarea::new(&self.document)
                            .readonly(true)
                            .h(height)
                            .role(None::<Role>),
                    ),
            )
            .child(
                // The locked Component Link predates keyboard activation;
                // Base Link owns the current focus and accessibility behavior.
                Link::new("legal-support")
                    .accessibility_label(tr("legal.support"))
                    .child(tr("legal.support"))
                    .text_color(cx.theme().link)
                    .text_decoration_1()
                    .text_decoration_color(cx.theme().link)
                    .cursor_pointer()
                    .p_1()
                    .rounded(cx.theme().radius)
                    .border_1()
                    .border_color(cx.theme().border.opacity(0.))
                    .focus_visible(move |style| style.border_color(ring))
                    .key_context("LegalSupport")
                    .on_action(|_: &OpenSupport, _, cx| cx.open_url(SUPPORT_URL))
                    .href(SUPPORT_URL)
                    .open_with(|url, _, _, cx| cx.open_url(url)),
            )
    }
}

fn open(kind: DocumentKind, window: &mut Window, cx: &mut App) -> Entity<LegalDialog> {
    install_keymap(cx);
    let view = cx.new(|cx| LegalDialog::new(kind, window, cx));
    let content = view.clone();
    window.open_dialog(cx, move |dialog, window, cx| {
        dialog
            .glass_dialog(cx)
            // The footer's own close button is the one way out besides
            // Escape: Kit's corner button is named "Close" in every language.
            .close_button(false)
            .title(dialog_title(kind.title()))
            .w(
                (window.rem_size() * 40.)
                    .min(window.viewport_size().width - window.rem_size() * 2.),
            )
            .content({
                let content = content.clone();
                move |body, _, _| body.child(content.clone())
            })
            .footer(
                Button::new("legal-close")
                    .outline()
                    .label(tr("legal.close"))
                    .on_click(|_, window, cx| window.close_dialog(cx)),
            )
    });
    // The modal host's focus handle has no readable content. Put initial
    // keyboard/AX focus on the retained reading control after Root saves the
    // trigger, so VoiceOver enters the document and dismissal restores it.
    view.update(cx, |view, cx| {
        view.document
            .update(cx, |document, cx| document.focus(window, cx));
    });
    view
}

pub fn open_privacy(window: &mut Window, cx: &mut App) -> Entity<LegalDialog> {
    open(DocumentKind::Privacy, window, cx)
}

pub fn open_licenses(window: &mut Window, cx: &mut App) -> Entity<LegalDialog> {
    open(DocumentKind::Licenses, window, cx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{Bounds, TestAppContext, WindowBounds, WindowOptions, px, size};

    struct Host;
    impl Render for Host {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
        }
    }

    #[gpui_kit::test]
    fn complete_license_document_scrolls_to_the_end_and_fits_a_zoomed_small_window(
        cx: &mut TestAppContext,
    ) {
        let (handle, view) = cx.update(|cx| {
            imgconvert_gpui_shared::services::init_with_settings(cx, || {
                imgconvert_gpui_shared::SettingsModel::in_memory(
                    imgconvert_platform::settings::Settings::default(),
                )
            });
            gpui_kit::init(cx);
            // Dialogs paint with the product's glass tokens, as in the app.
            imgconvert_gpui_shared::theme::install(cx);
            let (handle, _) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                        gpui_kit::Point::default(),
                        size(px(760.), px(480.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |_, cx| cx.new(|_| Host),
            )
            .unwrap();
            let view = handle
                .update(cx, |_, window, cx| open_licenses(window, cx))
                .unwrap();
            (handle, view)
        });
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("legal-document", cx);
            let before = view.read(cx).document.read(cx).scroll_offset();
            let end_key = if cfg!(target_os = "macos") {
                "cmd-down"
            } else {
                "ctrl-end"
            };
            window.press(end_key, cx);
            window.render_frame(cx);
            let document = view.read(cx).document.read(cx);
            assert_eq!(document.cursor(), LICENSES.len());
            assert!(
                document.scroll_offset().y < before.y,
                "the visible viewport moved to the end"
            );
            assert!(document.visible_row_range().unwrap().start > 0);
            let font = gpui_kit::component::Theme::global(cx).font_size;
            gpui_kit::component::Theme::update(cx, |theme| theme.font_size = font * 1.15);
            window.render_frame(cx);
            let body = window.find("legal-document").bounds();
            let close = window.find("legal-close").bounds();
            assert!(body.right() < window.viewport_size().width);
            assert!(body.bottom() < close.origin.y);
            assert!(close.bottom() < window.viewport_size().height);
        })
        .unwrap();
    }
}
