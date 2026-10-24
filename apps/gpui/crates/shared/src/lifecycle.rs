// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Application-wide quit state shared by the shell and the feature crates.
//!
//! The shell's quit coordinator sets the latch before it decides anything,
//! so a Start that races the quit (a queued plan, an output-folder picker
//! that returns late) is refused at [`crate::progress_bridge::start_batch`]
//! instead of beginning a batch the process is about to abandon. Views
//! register hooks that commit unsaved drafts before the settings are
//! flushed.

use std::rc::Rc;

use gpui_kit::{App, Global};

#[derive(Default)]
struct QuitLatch(bool);

impl Global for QuitLatch {}

/// Whether the application is quitting; no new batch may start.
pub fn is_quitting(cx: &App) -> bool {
    cx.try_global::<QuitLatch>().is_some_and(|latch| latch.0)
}

/// Sets or clears the latch ("keep converting" clears it).
pub fn set_quitting(quitting: bool, cx: &mut App) {
    cx.set_global(QuitLatch(quitting));
}

type Hook = Rc<dyn Fn(&mut App)>;

#[derive(Default)]
struct BeforeQuitHooks(Vec<Hook>);

impl Global for BeforeQuitHooks {}

/// Registers a hook run when a quit is requested, before anything is
/// stopped or flushed. Hooks commit drafts; they must not block.
pub fn on_before_quit(hook: impl Fn(&mut App) + 'static, cx: &mut App) {
    cx.default_global::<BeforeQuitHooks>().0.push(Rc::new(hook));
}

/// Runs every registered hook. Hooks stay registered: "keep converting"
/// followed by a second quit runs them again.
pub fn run_before_quit_hooks(cx: &mut App) {
    let hooks = cx
        .try_global::<BeforeQuitHooks>()
        .map(|hooks| hooks.0.clone())
        .unwrap_or_default();
    for hook in hooks {
        hook(cx);
    }
}
