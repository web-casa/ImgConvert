// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Application settings surfaces include offline legal documents and updates.
//! Application-owned update state survives closing its dialog. Network and disk
//! work runs outside GPUI; the view only presents state and issues commands.

pub mod legal;

#[cfg(feature = "updater")]
mod service;

use gpui_kit::{InteractiveElement as _, StatefulInteractiveElement as _};

use futures::{
    FutureExt as _,
    future::{Either, select},
};
use gpui_kit::component::button::Button;
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::spinner::Spinner;
use gpui_kit::component::{ActiveTheme as _, WindowExt as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, Context, Entity, Global, IntoElement, ParentElement as _, Render,
    Styled as _, Subscription, TestSupportExt as _, Window, div, rems,
};
use imgconvert_gpui_shared::a11y::DisabledForAll as _;
use imgconvert_gpui_shared::i18n::{tr, tr_with};
use imgconvert_gpui_shared::theme::GlassStyled as _;
use imgconvert_gpui_shared::{AppModels, tasks};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;

#[derive(Clone)]
struct Offer {
    version: String,
    notes: String,
    #[cfg(feature = "updater")]
    url: String,
    #[cfg(feature = "updater")]
    signature: String,
}

trait Driver: Send + Sync {
    fn check(&self) -> Result<Option<Offer>, String>;
    fn download(&self, offer: &Offer, progress: &AtomicU64) -> Result<Vec<u8>, String>;
    fn install(&self, bytes: &[u8]) -> Result<(), String>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdatePhase {
    Manual,
    Idle,
    Checking,
    Current,
    Available,
    Downloading,
    Ready,
    Installing,
    Installed,
}

/// The application retains this model; each dialog observes it weakly.
pub struct UpdateModel {
    driver: Option<Arc<dyn Driver>>,
    phase: UpdatePhase,
    offer: Option<Offer>,
    package: Option<Vec<u8>>,
    error: Option<String>,
    downloaded: u64,
    revision: u64,
}

impl UpdateModel {
    fn new(driver: Option<Arc<dyn Driver>>) -> Self {
        Self {
            phase: if driver.is_some() {
                UpdatePhase::Idle
            } else {
                UpdatePhase::Manual
            },
            driver,
            offer: None,
            package: None,
            error: None,
            downloaded: 0,
            revision: 0,
        }
    }
    pub fn phase(&self) -> UpdatePhase {
        self.phase
    }
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
    fn busy(&self) -> bool {
        matches!(
            self.phase,
            UpdatePhase::Checking | UpdatePhase::Downloading | UpdatePhase::Installing
        )
    }

    fn check(&mut self, cx: &mut Context<Self>) {
        if self.busy() || self.phase == UpdatePhase::Installed {
            return;
        }
        let Some(driver) = self.driver.clone() else {
            return;
        };
        self.revision += 1;
        let revision = self.revision;
        self.phase = UpdatePhase::Checking;
        self.error = None;
        self.offer = None;
        self.package = None;
        self.downloaded = 0;
        cx.notify();
        let task = tasks::run_blocking("imgconvert-update-check", cx, move || driver.check());
        cx.spawn(async move |this, cx| {
            let outcome = task.await.and_then(std::convert::identity);
            let _ = this.update(cx, |this, cx| {
                if revision != this.revision {
                    return;
                }
                match outcome {
                    Ok(Some(offer)) => {
                        this.offer = Some(offer);
                        this.phase = UpdatePhase::Available;
                    }
                    Ok(None) => this.phase = UpdatePhase::Current,
                    Err(error) => {
                        this.phase = UpdatePhase::Idle;
                        this.error = Some(error);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn download(&mut self, cx: &mut Context<Self>) {
        if self.phase != UpdatePhase::Available {
            return;
        }
        let (Some(driver), Some(offer)) = (self.driver.clone(), self.offer.clone()) else {
            return;
        };
        self.phase = UpdatePhase::Downloading;
        self.error = None;
        self.downloaded = 0;
        let revision = self.revision;
        cx.notify();
        let progress = Arc::new(AtomicU64::new(0));
        let for_worker = progress.clone();
        let mut task = tasks::run_blocking("imgconvert-update-download", cx, move || {
            driver.download(&offer, &for_worker)
        })
        .boxed();
        cx.spawn(async move |this, cx| {
            let result = loop {
                let tick = cx
                    .background_executor()
                    .timer(Duration::from_millis(100))
                    .boxed();
                match select(task, tick).await {
                    Either::Left((result, _)) => break result.and_then(std::convert::identity),
                    Either::Right(((), remaining)) => {
                        task = remaining;
                        let bytes = progress.load(Ordering::Relaxed);
                        let _ = this.update(cx, |this, cx| {
                            if this.revision == revision && this.downloaded != bytes {
                                this.downloaded = bytes;
                                cx.notify();
                            }
                        });
                    }
                }
            };
            let _ = this.update(cx, |this, cx| {
                if this.revision != revision {
                    return;
                }
                match result {
                    Ok(bytes) => {
                        this.downloaded = bytes.len() as u64;
                        this.package = Some(bytes);
                        this.phase = UpdatePhase::Ready;
                    }
                    Err(error) => {
                        this.phase = UpdatePhase::Available;
                        this.error = Some(error);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn install(&mut self, cx: &mut Context<Self>) {
        if self.phase != UpdatePhase::Ready {
            return;
        }
        if AppModels::global(cx).batch().read(cx).is_active() {
            self.error = Some(tr("update.batch_active").to_string());
            cx.notify();
            return;
        }
        // Flush before installation; installation itself never reads the store.
        let settings = AppModels::global(cx).settings().clone();
        if let Err(error) = settings.update(cx, imgconvert_gpui_shared::SettingsModel::flush) {
            self.error = Some(error.to_string());
            cx.notify();
            return;
        }
        let (Some(driver), Some(bytes)) = (self.driver.clone(), self.package.take()) else {
            return;
        };
        self.phase = UpdatePhase::Installing;
        self.error = None;
        cx.notify();
        let task = tasks::run_blocking("imgconvert-update-install", cx, move || {
            driver.install(&bytes)
        });
        cx.spawn(async move |this, cx| {
            let outcome = task.await.and_then(std::convert::identity);
            let _ = this.update(cx, |this, cx| {
                match outcome {
                    Ok(()) => this.phase = UpdatePhase::Installed,
                    Err(error) => {
                        this.phase = UpdatePhase::Available;
                        this.error = Some(error);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
}

struct Updates(Entity<UpdateModel>);
impl Global for Updates {}

/// Store builds compile without `updater` and omit every update entry point.
pub fn is_visible() -> bool {
    cfg!(feature = "updater") && option_env!("IMGCONVERT_DISABLE_UPDATER") != Some("1")
}

pub fn init(cx: &mut App) {
    if cx.has_global::<Updates>() {
        return;
    }
    #[cfg(feature = "updater")]
    let driver = service::configured_driver();
    #[cfg(not(feature = "updater"))]
    let driver = None;
    let model = cx.new(|_| UpdateModel::new(driver));
    cx.set_global(Updates(model));
}

pub struct UpdatesDialog {
    model: Entity<UpdateModel>,
    _subscription: Subscription,
}
impl Render for UpdatesDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let model = self.model.read(cx);
        let phase = model.phase;
        let key = match phase {
            UpdatePhase::Manual => "update.manual",
            UpdatePhase::Idle => "update.idle",
            UpdatePhase::Checking => "update.checking",
            UpdatePhase::Current => "update.current",
            UpdatePhase::Available => "update.available",
            UpdatePhase::Downloading => "update.downloading",
            UpdatePhase::Ready => "update.ready",
            UpdatePhase::Installing => "update.installing",
            UpdatePhase::Installed => "update.installed",
        };
        let state = tr(key);
        let error = model.error.clone();
        let version = model.offer.as_ref().map(|o| o.version.clone());
        let notes = model
            .offer
            .as_ref()
            .map(|o| o.notes.clone())
            .unwrap_or_default();
        let bytes = model.downloaded;
        let busy = model.busy();
        let check = self.model.clone();
        let download = self.model.clone();
        let install = self.model.clone();
        v_flex()
            .gap_3()
            .min_w_0()
            .child(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child(tr_with(
                        "update.current_version",
                        &[("version", &env!("CARGO_PKG_VERSION"))],
                    )),
            )
            .child(
                h_flex()
                    .gap_2()
                    .when(busy, |row| row.child(Spinner::new()))
                    .child(
                        div()
                            .id("update-status")
                            .test_support()
                            .aria_label(state.clone())
                            .child(state),
                    ),
            )
            .when_some(version, |view, version| {
                view.child(
                    div()
                        .text_sm()
                        .child(tr_with("update.new_version", &[("version", &version)])),
                )
            })
            .when(!notes.is_empty(), |view| {
                view.child(
                    div()
                        .id("update-notes")
                        .max_h(rems(12.))
                        .min_h_0()
                        .overflow_y_scrollbar()
                        .text_sm()
                        .child(notes),
                )
            })
            .when(phase == UpdatePhase::Downloading, |view| {
                view.child(
                    div()
                        .text_sm()
                        .child(tr_with("update.bytes", &[("bytes", &bytes)])),
                )
            })
            .when_some(error, |view, error| {
                view.child(
                    div()
                        .id("update-error")
                        .test_support()
                        .aria_label(error.clone())
                        .text_sm()
                        .text_color(cx.theme().danger)
                        .child(error),
                )
            })
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("update-check")
                            .outline()
                            .label(tr("update.check"))
                            .disabled_for_all(
                                busy || matches!(
                                    phase,
                                    UpdatePhase::Manual | UpdatePhase::Installed
                                ),
                            )
                            .on_click(move |_, _, cx| check.update(cx, UpdateModel::check)),
                    )
                    .when(phase == UpdatePhase::Available, |row| {
                        row.child(
                            Button::new("update-download")
                                .label(tr("update.download"))
                                .on_click(move |_, _, cx| {
                                    download.update(cx, UpdateModel::download);
                                }),
                        )
                    })
                    .when(phase == UpdatePhase::Ready, |row| {
                        row.child(
                            Button::new("update-install")
                                .label(tr("update.install"))
                                .on_click(move |_, _, cx| install.update(cx, UpdateModel::install)),
                        )
                    }),
            )
    }
}

pub fn open_updates(window: &mut Window, cx: &mut App) -> Option<Entity<UpdatesDialog>> {
    if !is_visible() {
        return None;
    }
    init(cx);
    let model = cx.global::<Updates>().0.clone();
    let view = cx.new(|cx| {
        let subscription = cx.observe(&model, |_, _, cx| cx.notify());
        UpdatesDialog {
            model,
            _subscription: subscription,
        }
    });
    let content = view.clone();
    window.open_dialog(cx, move |dialog, window, cx| {
        let content = content.clone();
        dialog
            .glass_dialog(cx)
            // The footer's own close button is the one way out besides
            // Escape: Kit's corner button is named "Close" in every language.
            .close_button(false)
            .title(tr("update.title"))
            .w(window.rem_size() * 32.)
            .content(move |body, _, _| body.child(content.clone()))
            .footer(
                Button::new("update-close")
                    .outline()
                    .label(tr("update.close"))
                    .on_click(|_, window, cx| window.close_dialog(cx)),
            )
    });
    Some(view)
}

#[cfg(all(test, feature = "updater"))]
mod tests {
    use super::*;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{Bounds, TestAppContext, WindowBounds, WindowOptions, px, size};
    use imgconvert_gpui_shared::i18n::{Locale, set_locale};
    use imgconvert_gpui_shared::{SettingsModel, services};
    use imgconvert_platform::settings::Settings;
    use std::sync::atomic::AtomicUsize;

    struct Fake {
        checks: AtomicUsize,
        installed: AtomicUsize,
    }
    impl Driver for Fake {
        fn check(&self) -> Result<Option<Offer>, String> {
            if self.checks.fetch_add(1, Ordering::SeqCst) == 0 {
                return Err("offline".into());
            }
            Ok(Some(Offer {
                version: "0.4.0".into(),
                notes: "Release notes".into(),
                url: String::new(),
                signature: String::new(),
            }))
        }
        fn download(&self, _: &Offer, progress: &AtomicU64) -> Result<Vec<u8>, String> {
            progress.store(8, Ordering::Relaxed);
            Ok(vec![1; 8])
        }
        fn install(&self, _: &[u8]) -> Result<(), String> {
            self.installed.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }
    struct Host;
    impl Render for Host {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full()
        }
    }
    fn wait(cx: &mut TestAppContext, model: &Entity<UpdateModel>, phase: UpdatePhase) {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            cx.executor().advance_clock(Duration::from_millis(100));
            cx.run_until_parked();
            if cx.update(|cx| model.read(cx).phase()) == phase {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "update phase never reached {phase:?}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[gpui_kit::test]
    fn real_dialog_retries_failure_verifies_download_and_preserves_state_after_close(
        cx: &mut TestAppContext,
    ) {
        let driver = Arc::new(Fake {
            checks: AtomicUsize::new(0),
            installed: AtomicUsize::new(0),
        });
        let (handle, model) = cx.update(|cx| {
            gpui_kit::init(cx);
            set_locale(Locale::English);
            services::init_with_settings(cx, || SettingsModel::in_memory(Settings::default()));
            // Dialogs paint with the product's glass tokens, as in the app.
            imgconvert_gpui_shared::theme::install(cx);
            let model = cx.new(|_| UpdateModel::new(Some(driver.clone())));
            cx.set_global(Updates(model.clone()));
            let (handle, _) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                        gpui_kit::Point::default(),
                        size(px(800.), px(600.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |_, cx| cx.new(|_| Host),
            )
            .unwrap();
            (handle, model)
        });
        cx.update_window(handle, |_, window, cx| {
            open_updates(window, cx).unwrap();
            window.render_frame(cx);
            window.click("update-check", cx);
            window.click("update-check", cx);
        })
        .unwrap();
        wait(cx, &model, UpdatePhase::Idle);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("update-error").label(), Some("offline"));
            window.click("update-check", cx);
        })
        .unwrap();
        wait(cx, &model, UpdatePhase::Available);
        assert_eq!(
            driver.checks.load(Ordering::SeqCst),
            2,
            "duplicate check ignored"
        );
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("update-download", cx);
            window.render_frame(cx);
            assert_eq!(
                window.find("update-status").label(),
                Some("Downloading and verifying the update")
            );
        })
        .unwrap();
        wait(cx, &model, UpdatePhase::Ready);
        cx.update_window(handle, |_, window, cx| {
            window.close_dialog(cx);
            window.render_frame(cx);
            open_updates(window, cx);
            window.render_frame(cx);
            assert!(window.find("update-install").visible());
            assert!(window.find("update-close").visible());
            assert!(window.try_find("close").is_none(), "no corner close button");
            window.click("update-install", cx);
        })
        .unwrap();
        wait(cx, &model, UpdatePhase::Installed);
        assert_eq!(driver.installed.load(Ordering::SeqCst), 1);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("update-check", cx);
            assert_eq!(model.read(cx).phase(), UpdatePhase::Installed);
            window.press("escape", cx);
            window.render_frame(cx);
            assert!(window.try_find("update-close").is_none());
        })
        .unwrap();
    }
}
