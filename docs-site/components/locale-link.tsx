"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { getLocalePath } from "@/lib/locale-routing";
import type { DocsLocale } from "@/lib/locale-routing";

type LocaleLinkProps = {
  locale: DocsLocale;
};

export function LocaleLink({ locale }: LocaleLinkProps) {
  const pathname = usePathname();
  const targetLocale: DocsLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
  const label = targetLocale === "en-US" ? "English" : "简体中文";
  const title = targetLocale === "en-US" ? "Switch to English" : "切换至简体中文";

  return (
    <Link
      aria-label={title}
      className="rounded-md px-2 py-1 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
      data-testid="locale-switcher"
      href={getLocalePath(pathname ?? "/", targetLocale)}
      title={title}
    >
      {label}
    </Link>
  );
}
