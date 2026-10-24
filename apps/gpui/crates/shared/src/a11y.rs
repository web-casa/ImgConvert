// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Accessibility helpers shared by the views.

use gpui_kit::component::Disableable;
use gpui_kit::{
    InteractiveElement, IntoElement, ParentElement as _, Role, SharedString,
    StatefulInteractiveElement as _, div,
};

/// Disables a control for the pointer, the keyboard and assistive
/// technology alike. Kit's `disabled` covers the first two only: it has no
/// way to tell AccessKit, so VoiceOver would announce the control as
/// available. Use this instead of `disabled` on controls that can take it.
pub trait DisabledForAll: Disableable + InteractiveElement {
    #[must_use]
    fn disabled_for_all(self, disabled: bool) -> Self {
        self.disabled(disabled).aria_disabled(disabled)
    }
}

impl<T: Disableable + InteractiveElement> DisabledForAll for T {}

/// A dialog title that assistive technology names the dialog after. Kit's
/// modal host has the dialog role but no name, so VoiceOver announced an
/// opened dialog only as "window"; the vendored GPUI names an unlabeled
/// dialog after its first heading.
pub fn dialog_title(title: impl Into<SharedString>) -> impl IntoElement {
    let title = title.into();
    div()
        .id("dialog-heading")
        .role(Role::Heading)
        .aria_label(title.clone())
        .child(title)
}
