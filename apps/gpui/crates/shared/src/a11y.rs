// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Accessibility helpers shared by the views.

use gpui_kit::InteractiveElement;
use gpui_kit::component::Disableable;

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
