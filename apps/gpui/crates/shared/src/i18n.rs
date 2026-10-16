// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Interface strings. Keys describe intent (`queue.add_files`), never a
//! source-language sentence; both locales are written in `locales/app.yml`.
//!
//! The locale is one global shared with GPUI Kit's own strings because this
//! crate and `gpui-component` link the same `rust-i18n` major version.

use gpui_kit::SharedString;

/// Locales the shell ships. Order is the toggle order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    English,
    SimplifiedChinese,
}

impl Locale {
    pub const fn tag(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::SimplifiedChinese => "zh-CN",
        }
    }

    pub const fn next(self) -> Self {
        match self {
            Self::English => Self::SimplifiedChinese,
            Self::SimplifiedChinese => Self::English,
        }
    }

    /// Picks the start-up locale from the POSIX locale variables; Chinese
    /// variants map to Simplified Chinese, everything else to English.
    pub fn from_environment() -> Self {
        ["LC_ALL", "LC_MESSAGES", "LANG"]
            .iter()
            .filter_map(|name| std::env::var(name).ok())
            .find(|value| !value.is_empty())
            .map_or(Self::English, |value| Self::from_tag(&value))
    }

    pub fn from_tag(tag: &str) -> Self {
        let lowered = tag.to_ascii_lowercase();
        if lowered.starts_with("zh") {
            Self::SimplifiedChinese
        } else {
            Self::English
        }
    }

    pub fn current() -> Self {
        Self::from_tag(&rust_i18n::locale())
    }
}

/// Sets the global locale for app and Kit strings. Callers must refresh the
/// windows afterwards: the locale is outside GPUI's change tracking.
pub fn set_locale(locale: Locale) {
    gpui_kit::component::set_locale(locale.tag());
}

/// Looks a key up in the current locale.
pub fn tr(key: &str) -> SharedString {
    SharedString::from(rust_i18n::t!(key).into_owned())
}

/// Looks a key up and substitutes `%{name}` placeholders.
pub fn tr_with(key: &str, args: &[(&str, &dyn std::fmt::Display)]) -> SharedString {
    let mut text = rust_i18n::t!(key).into_owned();
    for (name, value) in args {
        text = text.replace(&format!("%{{{name}}}"), &value.to_string());
    }
    SharedString::from(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The locale is process-wide; tests that change it must not overlap.
    static LOCALE_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn both_locales_resolve_the_same_keys() {
        let _guard = LOCALE_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        set_locale(Locale::English);
        assert_eq!(tr("queue.add_files").as_ref(), "Add files…");
        set_locale(Locale::SimplifiedChinese);
        assert_eq!(tr("queue.add_files").as_ref(), "添加文件…");
        set_locale(Locale::English);
    }

    #[test]
    fn placeholders_are_substituted() {
        let _guard = LOCALE_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        set_locale(Locale::English);
        let text = tr_with("queue.item_count", &[("count", &42)]);
        assert_eq!(text.as_ref(), "42 items");
    }

    #[test]
    fn locale_tags_map_chinese_variants_to_simplified() {
        assert_eq!(Locale::from_tag("zh_CN.UTF-8"), Locale::SimplifiedChinese);
        assert_eq!(Locale::from_tag("zh-Hant-TW"), Locale::SimplifiedChinese);
        assert_eq!(Locale::from_tag("en_US.UTF-8"), Locale::English);
        assert_eq!(Locale::English.next().next(), Locale::English);
    }
}
