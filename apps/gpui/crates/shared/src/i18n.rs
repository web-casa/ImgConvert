// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Interface strings. Keys describe intent (`queue.add_files`), never a
//! source-language sentence; both locales are written in `locales/app.yml`.
//!
//! The locale is one global shared with GPUI Kit's own strings because this
//! crate and `gpui-component` link the same `rust-i18n` major version.

use gpui_kit::SharedString;
use imgconvert_backend::settings::AppLocale;

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

    /// The persisted settings value for this interface locale.
    pub const fn app_locale(self) -> AppLocale {
        match self {
            Self::English => AppLocale::EnUs,
            Self::SimplifiedChinese => AppLocale::ZhCn,
        }
    }

    pub const fn from_app_locale(locale: AppLocale) -> Self {
        match locale {
            AppLocale::EnUs => Self::English,
            AppLocale::ZhCn => Self::SimplifiedChinese,
        }
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
    let template = rust_i18n::t!(key);
    SharedString::from(interpolate(&template, args))
}

fn interpolate(template: &str, args: &[(&str, &dyn std::fmt::Display)]) -> String {
    let mut text = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("%{") {
        text.push_str(&rest[..start]);
        let placeholder = &rest[start..];
        let Some(end) = placeholder.find('}') else {
            text.push_str(placeholder);
            return text;
        };
        let name = &placeholder[2..end];
        if let Some((_, value)) = args.iter().find(|(key, _)| *key == name) {
            text.push_str(&value.to_string());
        } else {
            text.push_str(&placeholder[..=end]);
        }
        rest = &placeholder[end + 1..];
    }
    text.push_str(rest);
    text
}

#[cfg(test)]
pub(crate) static LOCALE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

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
    fn every_app_key_has_both_locales_and_matching_placeholders() {
        let _guard = LOCALE_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let source = include_str!("../locales/app.yml");
        for line in source
            .lines()
            .filter(|line| !line.starts_with([' ', '#', '_']) && line.ends_with(':'))
        {
            let key = line.trim_end_matches(':');
            let english = rust_i18n::t!(key, locale = "en");
            let chinese = rust_i18n::t!(key, locale = "zh-CN");
            assert_ne!(english, key, "missing English: {key}");
            assert_ne!(chinese, key, "missing Chinese: {key}");
            let tokens = |text: &str| -> std::collections::BTreeSet<String> {
                text.split("%{")
                    .skip(1)
                    .filter_map(|part| part.split_once('}').map(|(name, _)| name.to_owned()))
                    .collect()
            };
            assert_eq!(tokens(&english), tokens(&chinese), "{key}");
            // Check explicit locale entries, too: English fallback must not
            // conceal a missing Chinese translation.
            let block = source
                .split_once(&format!("{key}:\n"))
                .unwrap()
                .1
                .split("\n\n")
                .next()
                .unwrap();
            assert!(
                block
                    .lines()
                    .take_while(|line| line.starts_with("  "))
                    .any(|line| line.starts_with("  zh-CN:")),
                "{key}"
            );
        }
        set_locale(Locale::SimplifiedChinese);
        assert_eq!(&*gpui_kit::component::locale(), "zh-CN");
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
    fn interpolation_preserves_values_and_unknown_tokens_literally() {
        assert_eq!(
            interpolate(
                "%{path}: %{count} / %{count} {count} %{unknown} %{",
                &[("path", &"%{count}.png"), ("count", &42)]
            ),
            "%{count}.png: 42 / 42 {count} %{unknown} %{"
        );
    }

    #[test]
    fn locale_tags_map_chinese_variants_to_simplified() {
        assert_eq!(Locale::from_tag("zh_CN.UTF-8"), Locale::SimplifiedChinese);
        assert_eq!(Locale::from_tag("zh-Hant-TW"), Locale::SimplifiedChinese);
        assert_eq!(Locale::from_tag("en_US.UTF-8"), Locale::English);
        assert_eq!(Locale::English.next().next(), Locale::English);
    }

    #[test]
    fn interface_locales_round_trip_through_the_settings_value() {
        for locale in [Locale::English, Locale::SimplifiedChinese] {
            assert_eq!(Locale::from_app_locale(locale.app_locale()), locale);
        }
        assert_eq!(Locale::English.app_locale().as_str(), "en-US");
    }
}
