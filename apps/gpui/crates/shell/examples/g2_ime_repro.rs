// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! A standalone G2 reproduction using only GPUI Kit. No ImgConvert services,
//! persisted settings, file access, or conversion work are initialized.

use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{ActiveTheme as _, WindowExt as _, button::Button};
use gpui_kit::{
    AppContext as _, Bounds, Context, Entity, IntoElement, ParentElement as _, Render, Styled as _,
    TitlebarOptions, Window, WindowBounds, WindowOptions, div, point, px, size,
};
use std::{cell::Cell, process::ExitCode, rc::Rc};

struct Repro {
    input: Entity<InputState>,
}

impl Repro {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            input: cx.new(|cx| InputState::new(window, cx)),
        }
    }
}

impl Render for Repro {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .size_full()
            .p_4()
            .gap_4()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child("Compose Chinese, then click Open dialog without confirming.")
            .child(Input::new(&self.input).aria_label("Composition"))
            .child(
                Button::new("repro-open")
                    .label("Open dialog")
                    .on_click(|_, window, cx| {
                        window.open_dialog(cx, |dialog, _, _| {
                            dialog
                                .title("IME focus")
                                .child("The previous input's candidate popup should close.")
                                .footer(
                                    Button::new("repro-close")
                                        .label("Close")
                                        .on_click(|_, window, cx| window.close_dialog(cx)),
                                )
                        });
                    }),
            )
            .child(
                Button::new("repro-quit")
                    .label("Quit")
                    .on_click(|_, _, cx| cx.quit()),
            )
    }
}

fn main() -> ExitCode {
    let failed = Rc::new(Cell::new(false));
    let startup_failed = Rc::clone(&failed);
    gpui_kit::application()
        .with_quit_mode(gpui_kit::QuitMode::LastWindowClosed)
        .with_assets(gpui_kit::assets::Assets)
        .run(move |cx| {
            gpui_kit::init(cx);
            let result = gpui_kit::open_window(
                WindowOptions {
                    titlebar: Some(TitlebarOptions {
                        title: Some("GPUI IME Repro".into()),
                        ..Default::default()
                    }),
                    // Physical coordinates are intentional for a reproducible
                    // native test window; its contents use rem-based layout.
                    window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                        point(px(350.), px(200.)),
                        size(px(600.), px(400.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |window, cx| cx.new(|cx| Repro::new(window, cx)),
            );
            match result {
                Ok(_) => cx.activate(true),
                Err(error) => {
                    eprintln!("cannot open IME reproduction: {error:#}");
                    startup_failed.set(true);
                    cx.quit();
                }
            }
        });
    if failed.get() {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
