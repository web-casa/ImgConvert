// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! The quit coordinator (docs/GPUI_MACOS_LIFECYCLE_PLAN.md §2.1–2.2).
//!
//! Every way out of the application ends here: the Quit action (⌘Q and the
//! menu), closing the main window, and the platform asking to terminate
//! (the Dock's Quit, log out, restart, shut down). Closing the main window
//! quits the application, as the Tauri shell did; the process never lingers
//! without a window while holding the instance marker.
//!
//! With no batch running the coordinator commits drafts, flushes the
//! settings and quits. While a batch runs it asks first; "Stop and Quit"
//! cancels the batch and waits for in-flight atomic writes on a worker
//! thread, so the window keeps responding. When the session ends there is
//! no time to ask: the batch is cancelled and waited for briefly on the
//! spot.

use std::time::Duration;

use gpui_kit::component::WindowExt as _;
use gpui_kit::component::button::ButtonVariant;
use gpui_kit::{AnyWindowHandle, App, AsyncApp, Global, TerminateReason, TerminateReply};
use imgconvert_gpui_shared::a11y::dialog_title;
use imgconvert_gpui_shared::i18n::tr;
use imgconvert_gpui_shared::theme::GlassStyled as _;
use imgconvert_gpui_shared::{Services, lifecycle, progress_bridge, settings_model, tasks};

/// How long "Stop and Quit" waits for in-flight atomic writes.
pub const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a session end waits; the system gives an application only a few
/// seconds before it reports it as not responding.
pub const SESSION_END_TIMEOUT: Duration = Duration::from_secs(5);

/// Where a quit request stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Phase {
    #[default]
    Running,
    /// The stop-and-quit confirmation is open.
    Confirming,
    /// The batch was cancelled; waiting for its writes before quitting.
    Stopping,
    /// Quitting; every further request is answered with "terminate".
    Exiting,
}

#[derive(Default)]
struct Coordinator {
    phase: Phase,
    main_window: Option<AnyWindowHandle>,
}

impl Global for Coordinator {}

/// Installs the coordinator and answers the platform's termination requests.
pub fn install(cx: &mut App) {
    cx.set_global(Coordinator::default());
    cx.on_should_terminate(should_terminate);
}

/// The window that hosts the confirmation.
pub fn set_main_window(window: AnyWindowHandle, cx: &mut App) {
    cx.default_global::<Coordinator>().main_window = Some(window);
}

pub fn phase(cx: &App) -> Phase {
    cx.try_global::<Coordinator>()
        .map_or(Phase::Running, |coordinator| coordinator.phase)
}

fn set_phase(phase: Phase, cx: &mut App) {
    cx.default_global::<Coordinator>().phase = phase;
}

/// Whether quitting now would interrupt a batch.
fn batch_active(cx: &App) -> bool {
    progress_bridge::is_busy(cx)
        || cx
            .try_global::<Services>()
            .is_some_and(|services| services.batch().is_active())
}

/// Closes the latch to new batches before anything else, so a Start racing
/// this request cannot begin a batch.
fn begin_quit(cx: &mut App) {
    lifecycle::set_quitting(true, cx);
}

/// The quit is final: commit drafts, then flush. Drafts are committed only
/// here so "Keep Converting" leaves them untouched.
fn finish(cx: &mut App) {
    set_phase(Phase::Exiting, cx);
    lifecycle::run_before_quit_hooks(cx);
    settings_model::flush(cx);
}

/// Quit requested by the user (⌘Q, the menu, closing the main window).
/// Repeated requests while one is in progress are absorbed.
pub fn request_quit(cx: &mut App) {
    if phase(cx) != Phase::Running {
        return;
    }
    begin_quit(cx);
    if !batch_active(cx) {
        exit(cx);
        return;
    }
    set_phase(Phase::Confirming, cx);
    // The request may come from inside the main window's update (a key
    // binding, the close button), where that window cannot open a dialog.
    cx.defer(|cx| {
        if phase(cx) == Phase::Confirming && !open_confirmation(cx) {
            stop_and_exit(cx);
        }
    });
}

/// Answers the main or blocked window's close button: closing quits the
/// application. With a batch running the window stays open and asks.
pub fn window_should_close(cx: &mut App) -> bool {
    match phase(cx) {
        Phase::Exiting => true,
        Phase::Confirming | Phase::Stopping => false,
        Phase::Running if !batch_active(cx) => {
            begin_quit(cx);
            exit(cx);
            true
        }
        Phase::Running => {
            request_quit(cx);
            false
        }
    }
}

/// Flushes the settings and quits. The platform then asks
/// [`should_terminate`] once more, which answers "now".
fn exit(cx: &mut App) {
    finish(cx);
    cx.quit();
}

/// "Keep Converting": the request is withdrawn.
fn resume(cx: &mut App) {
    if phase(cx) == Phase::Confirming {
        set_phase(Phase::Running, cx);
        lifecycle::set_quitting(false, cx);
    }
}

/// "Stop and Quit": cancels the batch and quits once its in-flight writes
/// have finished or [`SHUTDOWN_TIMEOUT`] has passed.
fn stop_and_exit(cx: &mut App) {
    set_phase(Phase::Stopping, cx);
    progress_bridge::cancel_batch(cx);
    let Some(service) = cx
        .try_global::<Services>()
        .map(|services| services.batch().clone())
    else {
        exit(cx);
        return;
    };
    let stopped = tasks::run_blocking("imgconvert-quit", cx, move || {
        service.shutdown(SHUTDOWN_TIMEOUT)
    });
    cx.spawn(async move |cx: &mut AsyncApp| {
        let _ = stopped.await;
        cx.update(exit);
    })
    .detach();
}

/// Opens the confirmation in the main window. False when there is no window
/// to host it.
fn open_confirmation(cx: &mut App) -> bool {
    let Some(handle) = cx
        .try_global::<Coordinator>()
        .and_then(|coordinator| coordinator.main_window)
    else {
        return false;
    };
    handle
        .update(cx, |_, window, cx| {
            window.activate_window();
            window.open_alert_dialog(cx, |dialog, _, cx| {
                dialog
                    .glass_dialog(cx)
                    .confirm()
                    .title(dialog_title(tr("app.quit_confirm_title")))
                    .description(tr("app.quit_confirm_body"))
                    .ok_text(tr("app.quit_confirm_stop"))
                    .ok_variant(ButtonVariant::Danger)
                    .cancel_text(tr("app.quit_confirm_keep"))
                    .on_ok(|_, _, cx| {
                        if phase(cx) == Phase::Confirming {
                            stop_and_exit(cx);
                        }
                        true
                    })
                    // Cancel, the close button and Escape all keep converting.
                    .on_close(|_, _, cx| resume(cx))
            });
        })
        .is_ok()
}

/// What a termination request leads to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Termination {
    /// Already quitting.
    Now,
    /// Nothing to stop: commit drafts, flush and terminate.
    Finish,
    /// The session ends: stop the batch briefly, flush and terminate.
    StopBriefly,
    /// Ask first; the confirmation quits by itself.
    Confirm,
    /// A confirmation is open or the batch is stopping.
    Defer,
}

fn termination(phase: Phase, reason: TerminateReason, batch_active: bool) -> Termination {
    match (phase, reason) {
        (Phase::Exiting, _) => Termination::Now,
        (_, TerminateReason::SessionEnd) => Termination::StopBriefly,
        (Phase::Running, TerminateReason::UserQuit) if batch_active => Termination::Confirm,
        (Phase::Running, TerminateReason::UserQuit) => Termination::Finish,
        (Phase::Confirming | Phase::Stopping, TerminateReason::UserQuit) => Termination::Defer,
    }
}

/// The platform asks before it terminates: after [`App::quit`], and on its
/// own for the Dock's Quit and when the session ends.
pub fn should_terminate(reason: TerminateReason, cx: &mut App) -> TerminateReply {
    match termination(phase(cx), reason, batch_active(cx)) {
        Termination::Now => TerminateReply::Now,
        Termination::Finish => {
            begin_quit(cx);
            finish(cx);
            TerminateReply::Now
        }
        Termination::StopBriefly => {
            begin_quit(cx);
            progress_bridge::cancel_batch(cx);
            let _ = Services::shutdown(cx, SESSION_END_TIMEOUT);
            finish(cx);
            TerminateReply::Now
        }
        Termination::Confirm => {
            request_quit(cx);
            TerminateReply::Cancel
        }
        Termination::Defer => TerminateReply::Cancel,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn termination_follows_the_phase_the_reason_and_the_batch() {
        use Phase::*;
        use TerminateReason::*;
        use Termination as T;
        let cases = [
            (Running, UserQuit, false, T::Finish),
            (Running, UserQuit, true, T::Confirm),
            (Confirming, UserQuit, true, T::Defer),
            (Stopping, UserQuit, true, T::Defer),
            // `App::quit` after the stop timed out: the batch may still run.
            (Exiting, UserQuit, true, T::Now),
            (Exiting, SessionEnd, true, T::Now),
            (Running, SessionEnd, false, T::StopBriefly),
            (Running, SessionEnd, true, T::StopBriefly),
            (Confirming, SessionEnd, true, T::StopBriefly),
            (Stopping, SessionEnd, true, T::StopBriefly),
        ];
        for (phase, reason, active, expected) in cases {
            assert_eq!(
                termination(phase, reason, active),
                expected,
                "{phase:?} {reason:?} active={active}"
            );
        }
    }
}
