export const docsLocales = ["zh-CN", "en-US"] as const;

export type DocsLocale = (typeof docsLocales)[number];

export const defaultDocsLocale: DocsLocale = "zh-CN";

const englishDocSlugs = new Set(["", "install", "usage", "privacy", "troubleshooting"]);

export function isDocsLocale(value: string): value is DocsLocale {
  return docsLocales.some((locale) => locale === value);
}

export function getDocsLocale(value: string): DocsLocale | undefined {
  return isDocsLocale(value) ? value : undefined;
}

export function localePath(locale: DocsLocale, pathname: string): string {
  const normalizedPath = normalizePathname(pathname);

  if (locale === defaultDocsLocale) {
    return normalizedPath;
  }

  return normalizedPath === "/" ? `/${locale}` : `/${locale}${normalizedPath}`;
}

export function getLocalePath(pathname: string, targetLocale: DocsLocale): string {
  const segments = normalizePathname(pathname).split("/").filter(Boolean);

  if (isDocsLocale(segments[0] ?? "")) {
    segments.shift();
  }

  const canonicalPath = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  const isDocsRoute = canonicalPath === "/docs" || canonicalPath.startsWith("/docs/");

  if (targetLocale === "en-US" && isDocsRoute) {
    const slug = canonicalPath.slice("/docs".length).replace(/^\//, "");

    if (!englishDocSlugs.has(slug)) {
      return localePath(targetLocale, "/docs");
    }
  }

  return localePath(targetLocale, canonicalPath);
}

export function frameworkPathname(locale: DocsLocale, pathname: string): string {
  const normalizedPath = normalizePathname(pathname);
  const hiddenDefaultPrefix = `/${defaultDocsLocale}`;

  if (
    locale !== defaultDocsLocale ||
    (normalizedPath !== hiddenDefaultPrefix &&
      !normalizedPath.startsWith(`${hiddenDefaultPrefix}/`))
  ) {
    return normalizedPath;
  }

  const withoutPrefix = normalizedPath.slice(hiddenDefaultPrefix.length);

  return withoutPrefix || "/";
}

function normalizePathname(pathname: string): string {
  const withoutQueryOrHash = pathname.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = withoutQueryOrHash.startsWith("/")
    ? withoutQueryOrHash
    : `/${withoutQueryOrHash}`;
  const normalized = withLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/$/, "");

  return normalized || "/";
}
