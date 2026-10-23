// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The header's Appearance popover: theme and reduced motion. These are
//! application preferences, not conversion settings, so they live behind a
//! window command instead of in the settings panel. Both controls write the
//! persisted settings record; `theme::apply` follows it.

use gpui_kit::component::button::{Button, ButtonRounded, ButtonVariants as _};
use gpui_kit::component::popover::Popover;
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{ActiveTheme as _, IconName, Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    Anchor, App, FontWeight, InteractiveElement as _, IntoElement, KeyDownEvent,
    ParentElement as _, Role, SharedString, StatefulInteractiveElement as _, Styled as _,
    TestSupportExt as _, Window, div, transparent_black,
};
use imgconvert_backend::settings::{Settings, Theme as ThemePreference};
use imgconvert_gpui_shared::AppModels;
use imgconvert_gpui_shared::i18n::tr;
use imgconvert_gpui_shared::theme::ActiveGlass as _;

/// The trigger's element id; tests and the shell's command use it.
pub const TRIGGER_ID: &str = "workspace-appearance";

const THEMES: [ThemePreference; 3] = [
    ThemePreference::System,
    ThemePreference::Light,
    ThemePreference::Dark,
];

/// The Appearance command and its popover.
pub fn appearance_popover(cx: &App) -> Popover {
    let pill = ButtonRounded::Size(cx.theme().radius_full());
    Popover::new("workspace-appearance-popover")
        .anchor(Anchor::TopRight)
        .trigger(
            Button::new(TRIGGER_ID)
                .ghost()
                .small()
                .rounded(pill)
                .icon(IconName::Palette)
                .accessibility_label(tr("settings.appearance_section"))
                .tooltip(tr("settings.appearance_section"))
                // The popover opens on its trigger's mouse-down. A click
                // listener is what makes the button pressable by assistive
                // technology, whose press GPUI performs as a pointer click.
                .on_click(|_, _, _| {}),
        )
        .content(|_, window, cx| render_appearance(window, cx))
}

fn edit(cx: &mut App, apply: impl FnOnce(&mut Settings) + 'static) {
    AppModels::global(cx)
        .settings()
        .clone()
        .update(cx, |model, cx| {
            model.update(cx, apply);
        });
}

fn theme_label(theme: ThemePreference) -> SharedString {
    tr(match theme {
        ThemePreference::System => "settings.theme_system",
        ThemePreference::Light => "settings.theme_light",
        ThemePreference::Dark => "settings.theme_dark",
    })
}

/// Arrow, Home and End keys move the theme selection.
fn theme_key(current: ThemePreference, event: &KeyDownEvent, cx: &mut App) {
    let index = THEMES.iter().position(|t| *t == current).unwrap_or(0);
    let last = THEMES.len() - 1;
    let next = match event.keystroke.key.as_str() {
        "left" | "up" => index.checked_sub(1).unwrap_or(last),
        "right" | "down" => (index + 1) % THEMES.len(),
        "home" => 0,
        "end" => last,
        _ => return,
    };
    cx.stop_propagation();
    let theme = THEMES[next];
    edit(cx, move |s| s.theme = theme);
}

fn render_appearance(window: &mut Window, cx: &mut App) -> impl IntoElement + use<> {
    // The theme group is one Tab stop with its own handle, kept across
    // renders of the popover content.
    let group_focus = window
        .use_keyed_state("appearance-theme-focus", cx, |_, cx| {
            cx.focus_handle().tab_stop(true)
        })
        .read(cx)
        .clone();
    let settings = AppModels::global(cx).settings().read(cx).settings();
    let current = settings.theme;
    let reduce_motion = settings.reduce_motion;
    let glass = cx.glass();
    let muted = cx.theme().muted_foreground;
    let pill = ButtonRounded::Size(cx.theme().radius_full());
    let ring = cx.theme().ring;
    v_flex()
        .id("appearance-panel")
        .test_support()
        .w_72()
        .gap_4()
        .child(
            div()
                .id("appearance-title")
                .test_support()
                .role(Role::Heading)
                .aria_label(tr("settings.appearance_section"))
                .text_sm()
                .font_weight(FontWeight::SEMIBOLD)
                .child(tr("settings.appearance_section")),
        )
        .child(
            v_flex()
                .gap_2()
                .child(
                    div()
                        .text_xs()
                        .text_color(muted)
                        .child(tr("settings.theme")),
                )
                .child(
                    h_flex()
                        .id("appearance-theme")
                        .test_support()
                        .role(Role::RadioGroup)
                        .aria_label(tr("settings.theme"))
                        .aria_value(theme_label(current))
                        .track_focus(&group_focus)
                        .border_1()
                        .border_color(transparent_black())
                        .focus_visible(move |style| style.border_color(ring))
                        .on_key_down(move |event: &KeyDownEvent, _, cx| {
                            theme_key(current, event, cx);
                        })
                        .p_0p5()
                        .gap_0p5()
                        .rounded(cx.theme().radius_full())
                        .bg(glass.chip())
                        .children(THEMES.into_iter().map(|theme| {
                            let selected = theme == current;
                            let group_focus = group_focus.clone();
                            Button::new(SharedString::from(format!(
                                "appearance-theme-{}",
                                theme.as_str()
                            )))
                            .ghost()
                            .small()
                            .role(Role::RadioButton)
                            .tab_stop(false)
                            .rounded(pill)
                            .flex_1()
                            .toggled(selected)
                            .label(theme_label(theme))
                            .when(selected, |button| {
                                button
                                    .bg(glass.chip_strong())
                                    .shadow(glass.lift_shadows())
                                    .font_weight(FontWeight::SEMIBOLD)
                            })
                            .on_click(move |_, window, cx| {
                                edit(cx, move |s| s.theme = theme);
                                window.focus(&group_focus, cx);
                            })
                        })),
                ),
        )
        .child(
            h_flex()
                .gap_3()
                .items_start()
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap_0p5()
                        .child(div().text_sm().child(tr("settings.reduce_motion_label")))
                        .child(
                            div()
                                .text_xs()
                                .text_color(muted)
                                .child(tr("settings.reduce_motion_description")),
                        ),
                )
                .child(
                    Switch::new("switch-reduce-motion")
                        .small()
                        .checked(reduce_motion)
                        .accessibility_label(tr("settings.reduce_motion_label"))
                        .on_change(|checked: &bool, _, cx| {
                            let on = *checked;
                            edit(cx, move |s| s.reduce_motion = on);
                        }),
                ),
        )
}
