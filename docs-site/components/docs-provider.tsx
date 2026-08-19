"use client";

import { FrameworkProvider } from "fumadocs-core/framework";
import type { Framework } from "fumadocs-core/framework";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

import { i18nProvider } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/base";

import { translations } from "@/lib/i18n";
import { defaultDocsLocale, frameworkPathname, type DocsLocale } from "@/lib/locale-routing";

const DocsLocaleContext = createContext<DocsLocale>(defaultDocsLocale);

const DocsLink: NonNullable<Framework["Link"]> = ({ href, prefetch, ...props }) => {
  if (!href) {
    return <a {...props} />;
  }

  return <Link {...props} href={href} prefetch={prefetch} />;
};

type DocsProviderProps = {
  children: ReactNode;
  locale: DocsLocale;
};

export function DocsProvider({ children, locale }: DocsProviderProps) {
  return (
    <DocsLocaleContext.Provider value={locale}>
      <FrameworkProvider
        Link={DocsLink}
        useParams={useParams}
        usePathname={useLocaleAwarePathname}
        useRouter={useRouter}
      >
        <RootProvider i18n={i18nProvider(translations, locale)}>{children}</RootProvider>
      </FrameworkProvider>
    </DocsLocaleContext.Provider>
  );
}

function useLocaleAwarePathname() {
  const locale = useContext(DocsLocaleContext);
  const pathname = usePathname();

  return frameworkPathname(locale, pathname);
}
