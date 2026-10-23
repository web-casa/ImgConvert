// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The header's language command: the current language by its own name,
//! opening a popover with every shipped language as a radio button, each
//! by its own name. A radio group (rather than a Kit menu) is used so
//! assistive technology hears which language is the current one.

use gpui_kit::component::button::{Button, ButtonRounded, ButtonVariants as _};
use gpui_kit::component::popover::Popover;
use gpui_kit::component::{ActiveTheme as _, IconName, Sizable as _, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    Anchor, App, FontWeight, InteractiveElement as _, IntoElement, KeyDownEvent,
    ParentElement as _, Role, SharedString, StatefulInteractiveElement as _, Styled as _,
    TestSupportExt as _, Window, div, transparent_black,
};
use imgconvert_gpui_shared::i18n::{Locale, tr, tr_with};
use imgconvert_gpui_shared::theme::ActiveGlass as _;

use crate::set_language;

/// The trigger's element id; tests use it.
pub const TRIGGER_ID: &str = "language-menu";

/// The language command and its popover.
pub fn language_popover(cx: &App) -> Popover {
    let pill = ButtonRounded::Size(cx.theme().radius_full());
    let current = Locale::current();
    Popover::new("language-popover")
        .anchor(Anchor::TopRight)
        .trigger(
            Button::new(TRIGGER_ID)
                .ghost()
                .small()
                .rounded(pill)
                .icon(IconName::Globe)
                .label(current.native_name())
                .accessibility_label(tr_with(
                    "app.language",
                    &[("language", &current.native_name())],
                ))
                // As for Appearance: the popover opens on mouse-down, and a
                // click listener makes the button pressable by assistive
                // technology.
                .on_click(|_, _, _| {}),
        )
        .content(|_, window, cx| render_languages(window, cx))
}

/// Arrow, Home and End keys move the selection, as in the theme group.
fn language_key(current: Locale, event: &KeyDownEvent, cx: &mut App) {
    let all = Locale::ALL;
    let index = all.iter().position(|l| *l == current).unwrap_or(0);
    let last = all.len() - 1;
    let next = match event.keystroke.key.as_str() {
        "up" | "left" => index.checked_sub(1).unwrap_or(last),
        "down" | "right" => (index + 1) % all.len(),
        "home" => 0,
        "end" => last,
        _ => return,
    };
    cx.stop_propagation();
    set_language(all[next], cx);
}

fn render_languages(window: &mut Window, cx: &mut App) -> impl IntoElement + use<> {
    let group_focus = window
        .use_keyed_state("language-group-focus", cx, |_, cx| {
            cx.focus_handle().tab_stop(true)
        })
        .read(cx)
        .clone();
    let current = Locale::current();
    let glass = cx.glass();
    let pill = ButtonRounded::Size(cx.theme().radius_full());
    let ring = cx.theme().ring;
    v_flex()
        .id("language-panel")
        .test_support()
        .w_56()
        .gap_2()
        .child(
            div()
                .id("language-title")
                .test_support()
                .role(Role::Heading)
                .aria_label(tr("app.language_title"))
                .text_sm()
                .font_weight(FontWeight::SEMIBOLD)
                .child(tr("app.language_title")),
        )
        .child(
            v_flex()
                .id("language-group")
                .test_support()
                .role(Role::RadioGroup)
                .aria_label(tr("app.language_title"))
                .aria_value(SharedString::from(current.native_name()))
                .track_focus(&group_focus)
                .border_1()
                .border_color(transparent_black())
                .focus_visible(move |style| style.border_color(ring))
                .on_key_down(move |event: &KeyDownEvent, _, cx| {
                    language_key(current, event, cx);
                })
                .gap_0p5()
                .children(Locale::ALL.into_iter().map(|locale| {
                    let selected = locale == current;
                    let group_focus = group_focus.clone();
                    Button::new(SharedString::from(format!("language-{}", locale.tag())))
                        .ghost()
                        .small()
                        .role(Role::RadioButton)
                        .tab_stop(false)
                        .rounded(pill)
                        .w_full()
                        .justify_start()
                        .toggled(selected)
                        .label(locale.native_name())
                        .when(selected, |button| {
                            button
                                .icon(IconName::Check)
                                .bg(glass.chip_strong())
                                .font_weight(FontWeight::SEMIBOLD)
                        })
                        .on_click(move |_, window, cx| {
                            set_language(locale, cx);
                            window.focus(&group_focus, cx);
                        })
                })),
        )
}
