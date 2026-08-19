import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { LocaleLink } from "@/components/locale-link";
import type { DocsLocale } from "@/lib/locale-routing";
import { localePath } from "@/lib/locale-routing";

const labels = {
  "zh-CN": {
    docs: "文档",
    release: "发布",
  },
  "en-US": {
    docs: "Docs",
    release: "Release",
  },
} as const;

export function baseOptions(locale: DocsLocale): BaseLayoutProps {
  const copy = labels[locale];

  return {
    i18n: false,
    nav: {
      title: (
        <>
          <span className="font-medium">ImgConvert</span>
          <span className="ml-2 text-xs opacity-40">Docs</span>
        </>
      ),
      url: localePath(locale, "/"),
    },
    links: [
      {
        text: copy.docs,
        url: localePath(locale, "/docs"),
        active: "url",
      },
      {
        children: <LocaleLink locale={locale} />,
        on: "all",
        type: "custom",
      },
      {
        text: "GitHub",
        url: "https://github.com/web-casa/ImgConvert",
        external: true,
      },
      {
        text: copy.release,
        url: "https://github.com/web-casa/ImgConvert/releases/tag/v0.1.2",
        external: true,
      },
    ],
  };
}
