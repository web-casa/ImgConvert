// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import type { Locale } from "./copy";

export const externalSiteLinks = Object.freeze({
  macAppStore: "https://apps.apple.com/cn/app/imgconvert/id6803600249",
  microsoftStore: "https://apps.microsoft.com/store/detail/9P1BWD965DBX?cid=DevShareMCLPCS",
  repository: "https://github.com/web-casa/ImgConvert",
});

export function localizedHome(locale: Locale): string {
  return locale === "zh" ? "/" : "/en/";
}

export function localizedHomeSection(
  locale: Locale,
  section: "download" | "faq" | "features" | "formats" | "guides",
): string {
  return `${localizedHome(locale)}#${section}`;
}

export function localizedContentPage(
  locale: Locale,
  page: "blog" | "docs" | "legal" | "privacy" | "environment",
): string {
  return locale === "zh" ? `/${page}/` : `/en/${page}/`;
}

export function localizedWebApp(locale: Locale): string {
  return `/convert/?lang=${locale}`;
}
