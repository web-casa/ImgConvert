// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Interface strings. Keys describe intent (`queue.add_files`), never a
//! source-language sentence. `locales/app.yml` holds English and Simplified
//! Chinese; every other locale has its own file in the same directory.
//!
//! The locale is one global shared with GPUI Kit's own strings because this
//! crate and `gpui-component` link the same `rust-i18n` major version.
//!
//! Known limits of the non-English, non-Chinese locales: Kit 0.7.1 ships its
//! own few strings (input context menu, select placeholder) only in en,
//! zh-CN, zh-HK, zh-TW and it, so they read English there; file sizes and
//! percentages use English number formatting in every locale; and the
//! privacy policy exists in English and Chinese (Simplified script).

use gpui_kit::SharedString;
use imgconvert_backend::settings::AppLocale;

/// Locales the shell ships, in the order the language menu lists them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    English,
    SimplifiedChinese,
    TraditionalChinese,
    Japanese,
    Korean,
    French,
    Spanish,
    Portuguese,
    German,
}

impl Locale {
    pub const ALL: [Self; 9] = [
        Self::English,
        Self::SimplifiedChinese,
        Self::TraditionalChinese,
        Self::Japanese,
        Self::Korean,
        Self::French,
        Self::Spanish,
        Self::Portuguese,
        Self::German,
    ];

    pub const fn tag(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::SimplifiedChinese => "zh-CN",
            Self::TraditionalChinese => "zh-TW",
            Self::Japanese => "ja",
            Self::Korean => "ko",
            Self::French => "fr",
            Self::Spanish => "es",
            Self::Portuguese => "pt-BR",
            Self::German => "de",
        }
    }

    /// The language's name in that language, as the language menu shows it.
    pub const fn native_name(self) -> &'static str {
        match self {
            Self::English => "English",
            Self::SimplifiedChinese => "简体中文",
            Self::TraditionalChinese => "繁體中文",
            Self::Japanese => "日本語",
            Self::Korean => "한국어",
            Self::French => "Français",
            Self::Spanish => "Español",
            Self::Portuguese => "Português (Brasil)",
            Self::German => "Deutsch",
        }
    }

    /// The other side of the quick switch: English from any other locale,
    /// Simplified Chinese from English.
    pub const fn toggled(self) -> Self {
        match self {
            Self::English => Self::SimplifiedChinese,
            _ => Self::English,
        }
    }

    /// Picks the start-up locale from the POSIX locale variables.
    pub fn from_environment() -> Self {
        ["LC_ALL", "LC_MESSAGES", "LANG"]
            .iter()
            .filter_map(|name| std::env::var(name).ok())
            .find(|value| !value.is_empty())
            .map_or(Self::English, |value| Self::from_tag(&value))
    }

    /// Maps a BCP 47 or POSIX tag to a shipped locale. Chinese follows an
    /// explicit script (Hans, Hant) first, then the region (TW, HK and MO
    /// read Traditional), then Simplified; the other shipped languages
    /// match by their primary subtag, and everything else is English.
    pub fn from_tag(tag: &str) -> Self {
        let lowered = tag.to_ascii_lowercase().replace('_', "-");
        let primary = lowered.split(['-', '.', '@']).next().unwrap_or("");
        match primary {
            "zh" => {
                let parts: Vec<&str> = lowered.split(['-', '.', '@']).skip(1).collect();
                let traditional = if parts.contains(&"hans") {
                    false
                } else {
                    parts.contains(&"hant")
                        || parts.iter().any(|part| matches!(*part, "tw" | "hk" | "mo"))
                };
                if traditional {
                    Self::TraditionalChinese
                } else {
                    Self::SimplifiedChinese
                }
            }
            "ja" => Self::Japanese,
            "ko" => Self::Korean,
            "fr" => Self::French,
            "es" => Self::Spanish,
            "pt" => Self::Portuguese,
            "de" => Self::German,
            _ => Self::English,
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
            Self::TraditionalChinese => AppLocale::ZhTw,
            Self::Japanese => AppLocale::Ja,
            Self::Korean => AppLocale::Ko,
            Self::French => AppLocale::Fr,
            Self::Spanish => AppLocale::Es,
            Self::Portuguese => AppLocale::PtBr,
            Self::German => AppLocale::De,
        }
    }

    pub const fn from_app_locale(locale: AppLocale) -> Self {
        match locale {
            AppLocale::EnUs => Self::English,
            AppLocale::ZhCn => Self::SimplifiedChinese,
            AppLocale::ZhTw => Self::TraditionalChinese,
            AppLocale::Ja => Self::Japanese,
            AppLocale::Ko => Self::Korean,
            AppLocale::Fr => Self::French,
            AppLocale::Es => Self::Spanish,
            AppLocale::PtBr => Self::Portuguese,
            AppLocale::De => Self::German,
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

/// [`tr_with`] for a message about `count` things, passed as the `name`
/// placeholder: when the current language puts `count` in its singular
/// category, the `<key>_one` variant is used, so English reads "1 file"
/// rather than "1 files". French and Portuguese also treat 0 as singular
/// (CLDR "one" is i = 0, 1). Every variant exists in every locale; Chinese,
/// Japanese and Korean have no plural, so their two texts are the same.
pub fn tr_count(
    key: &str,
    name: &str,
    count: usize,
    args: &[(&str, &dyn std::fmt::Display)],
) -> SharedString {
    let singular = match Locale::current() {
        Locale::French | Locale::Portuguese => count <= 1,
        _ => count == 1,
    };
    let key = if singular {
        format!("{key}_one")
    } else {
        key.to_owned()
    };
    let mut all: Vec<(&str, &dyn std::fmt::Display)> = vec![(name, &count)];
    all.extend_from_slice(args);
    tr_with(&key, &all)
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
        assert_eq!(tr("queue.add_files").as_ref(), "Add files");
        set_locale(Locale::SimplifiedChinese);
        assert_eq!(tr("queue.add_files").as_ref(), "添加文件");
        set_locale(Locale::English);
    }

    /// Every locale file, keyed by the locale it holds; `app.yml` holds the
    /// English source and Simplified Chinese.
    const LOCALE_FILES: [(&str, &str); 8] = [
        ("zh-CN", include_str!("../locales/app.yml")),
        ("zh-TW", include_str!("../locales/zh-TW.yml")),
        ("ja", include_str!("../locales/ja.yml")),
        ("ko", include_str!("../locales/ko.yml")),
        ("fr", include_str!("../locales/fr.yml")),
        ("es", include_str!("../locales/es.yml")),
        ("pt-BR", include_str!("../locales/pt-BR.yml")),
        ("de", include_str!("../locales/de.yml")),
    ];

    fn placeholders(text: &str) -> std::collections::BTreeSet<String> {
        text.split("%{")
            .skip(1)
            .filter_map(|part| part.split_once('}').map(|(name, _)| name.to_owned()))
            .collect()
    }

    #[test]
    fn every_app_key_has_every_locale_and_matching_placeholders() {
        let _guard = LOCALE_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let source = include_str!("../locales/app.yml");
        let keys: Vec<&str> = source
            .lines()
            .filter(|line| !line.starts_with([' ', '#', '_']) && line.ends_with(':'))
            .map(|line| line.trim_end_matches(':'))
            .collect();
        for key in &keys {
            let english = rust_i18n::t!(*key, locale = "en");
            assert_ne!(english, *key, "missing English: {key}");
            for (tag, file) in LOCALE_FILES {
                // An explicit entry, so English fallback cannot conceal a
                // missing translation.
                let block = file
                    .split_once(&format!("\n{key}:\n"))
                    .unwrap_or_else(|| panic!("{tag} lacks {key}"))
                    .1;
                assert!(
                    block
                        .lines()
                        .take_while(|line| line.starts_with("  "))
                        .any(|line| line.starts_with(&format!("  {tag}:"))),
                    "{tag} lacks {key}"
                );
                let text = rust_i18n::t!(*key, locale = tag);
                assert_eq!(placeholders(&english), placeholders(&text), "{tag} {key}");
            }
        }
        // The extra files hold only keys the source defines.
        for (tag, file) in &LOCALE_FILES[1..] {
            let extra = file
                .lines()
                .filter(|line| !line.starts_with([' ', '#', '_']) && line.ends_with(':'))
                .filter(|line| !keys.contains(&line.trim_end_matches(':')))
                .count();
            assert_eq!(extra, 0, "{tag} has keys the source lacks");
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

    /// Key, count placeholder, other arguments, text for one, text for two.
    type CountCase<'a> = (
        &'a str,
        &'a str,
        &'a [(&'a str, &'a dyn std::fmt::Display)],
        &'a str,
        &'a str,
    );

    #[test]
    fn counted_messages_use_the_singular_for_one() {
        let _guard = LOCALE_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        set_locale(Locale::English);
        let cases: [CountCase<'_>; 9] = [
            (
                "queue.clipboard_invalid_paths",
                "count",
                &[],
                "1 file path couldn’t be represented as UTF-8. Choose files with supported names.",
                "2 file paths couldn’t be represented as UTF-8. Choose files with supported names.",
            ),
            ("queue.item_count", "count", &[], "1 item", "2 items"),
            (
                "workflow.ready",
                "count",
                &[],
                "1 file ready",
                "2 files ready",
            ),
            (
                "queue.import_added",
                "added",
                &[],
                "Added 1 file",
                "Added 2 files",
            ),
            (
                "queue.import_added_skipped",
                "added",
                &[("skipped", &3)],
                "Added 1 file, skipped 3",
                "Added 2 files, skipped 3",
            ),
            (
                "queue.import_partial",
                "added",
                &[("detail", &"x")],
                "Added 1 file. x",
                "Added 2 files. x",
            ),
            ("queue.page_count", "count", &[], "1 page", "2 pages"),
            (
                "queue.clipboard_image_issues",
                "count",
                &[],
                "1 image couldn’t be imported. Copy a supported image within the size limits and try again.",
                "2 images couldn’t be imported. Copy a supported image within the size limits and try again.",
            ),
            (
                "workflow.animation_summary",
                "count",
                &[("animated", &0), ("unknown", &1)],
                "1 file · 0 animated (unsupported) · 1 unverified",
                "2 files · 0 animated (unsupported) · 1 unverified",
            ),
        ];
        for (key, name, args, one, two) in cases {
            assert_eq!(tr_count(key, name, 1, args).as_ref(), one, "{key}");
            assert_eq!(tr_count(key, name, 2, args).as_ref(), two, "{key}");
        }
        // French and Portuguese put 0 in the singular too.
        for locale in [Locale::French, Locale::Portuguese] {
            set_locale(locale);
            assert_eq!(
                tr_count("queue.item_count", "count", 0, &[]),
                tr_with("queue.item_count_one", &[("count", &0)]),
                "{locale:?}"
            );
            assert_ne!(
                tr_count("queue.item_count", "count", 2, &[]),
                tr_with("queue.item_count_one", &[("count", &2)]),
                "{locale:?}"
            );
        }
        set_locale(Locale::English);
        assert_eq!(
            tr_count("queue.item_count", "count", 0, &[]).as_ref(),
            "0 items"
        );
        // Chinese has one form, and never falls back to English.
        set_locale(Locale::SimplifiedChinese);
        assert_eq!(
            tr_count("queue.item_count", "count", 1, &[]).as_ref(),
            "1 个文件"
        );
        assert_eq!(
            tr_count("queue.import_added", "added", 1, &[]).as_ref(),
            "已添加 1 个文件"
        );
        set_locale(Locale::English);
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
    fn locale_tags_map_to_shipped_locales() {
        for (tag, locale) in [
            ("zh_CN.UTF-8", Locale::SimplifiedChinese),
            ("zh-Hans", Locale::SimplifiedChinese),
            ("zh-Hant-TW", Locale::TraditionalChinese),
            ("zh_TW.UTF-8", Locale::TraditionalChinese),
            ("zh-HK", Locale::TraditionalChinese),
            ("zh-Hans-TW", Locale::SimplifiedChinese),
            ("zh-Hans-HK", Locale::SimplifiedChinese),
            ("zh-Hant-CN", Locale::TraditionalChinese),
            ("ja_JP.UTF-8", Locale::Japanese),
            ("ko-KR", Locale::Korean),
            ("fr_CA.UTF-8", Locale::French),
            ("es-419", Locale::Spanish),
            ("pt_PT.UTF-8", Locale::Portuguese),
            ("de_DE@euro", Locale::German),
            ("en_US.UTF-8", Locale::English),
            ("it_IT.UTF-8", Locale::English),
            ("", Locale::English),
        ] {
            assert_eq!(Locale::from_tag(tag), locale, "{tag}");
        }
        for locale in Locale::ALL {
            assert_eq!(Locale::from_tag(locale.tag()), locale);
        }
        assert_eq!(Locale::English.toggled().toggled(), Locale::English);
        assert_eq!(Locale::German.toggled(), Locale::English);
    }

    #[test]
    fn interface_locales_round_trip_through_the_settings_value() {
        for locale in Locale::ALL {
            assert_eq!(Locale::from_app_locale(locale.app_locale()), locale);
        }
        assert_eq!(Locale::English.app_locale().as_str(), "en-US");
    }
}
