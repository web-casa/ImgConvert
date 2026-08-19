import Link from "next/link";
import type { ReactNode } from "react";

import { NavIcon } from "@/components/icons";
import type { DocsLocale } from "@/lib/locale-routing";
import { localePath } from "@/lib/locale-routing";

type SiteFooterProps = {
  locale: DocsLocale;
};

type FooterLink = {
  href: string;
  label: string;
};

const footerCopy: Record<
  DocsLocale,
  {
    commitment: string;
    docs: FooterLink[];
    docsTitle: string;
    engineering: FooterLink[];
    engineeringTitle: string;
    resourcesTitle: string;
  }
> = {
  "zh-CN": {
    commitment: "本地优先 · 不上传任何图片 · 主依赖树禁 GPL / AGPL / LGPL",
    docs: [
      { href: "/docs/install", label: "安装" },
      { href: "/docs/usage", label: "使用" },
      { href: "/docs/commands", label: "命令速查" },
    ],
    docsTitle: "文档",
    engineering: [
      { href: "/docs/architecture", label: "架构" },
      { href: "/docs/formats", label: "格式能力" },
      { href: "/docs/privacy", label: "隐私政策" },
    ],
    engineeringTitle: "工程",
    resourcesTitle: "资源",
  },
  "en-US": {
    commitment: "Local-first · No image uploads · GPL / AGPL / LGPL excluded",
    docs: [
      { href: "/docs/install", label: "Install" },
      { href: "/docs/usage", label: "Usage" },
      { href: "/docs/troubleshooting", label: "Troubleshooting" },
    ],
    docsTitle: "Docs",
    engineering: [{ href: "/docs/privacy", label: "Privacy policy" }],
    engineeringTitle: "Project",
    resourcesTitle: "Resources",
  },
};

export function SiteFooter({ locale }: SiteFooterProps) {
  const copy = footerCopy[locale];

  return (
    <footer className="site-footer">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          {/* Brand column */}
          <div className="flex items-center gap-3">
            <img
              alt="ImgConvert app icon"
              className="size-9 rounded-lg border border-[var(--imgconvert-line)]"
              height={36}
              src="/app-icon.png"
              width={36}
            />
            <div>
              <div className="text-sm font-semibold">ImgConvert</div>
              <div className="mono text-xs text-[var(--imgconvert-ink-soft)]">
                v0.1.2 · Apache-2.0
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3">
            <FooterCol title={copy.docsTitle}>
              {copy.docs.map((link) => (
                <Link className="block" href={localePath(locale, link.href)} key={link.href}>
                  {link.label}
                </Link>
              ))}
            </FooterCol>
            <FooterCol title={copy.engineeringTitle}>
              {copy.engineering.map((link) => (
                <Link className="block" href={localePath(locale, link.href)} key={link.href}>
                  {link.label}
                </Link>
              ))}
            </FooterCol>
            <FooterCol title={copy.resourcesTitle}>
              <a
                className="flex items-center gap-1.5"
                href="https://github.com/web-casa/ImgConvert"
                rel="noreferrer noopener"
                target="_blank"
              >
                GitHub
                <NavIcon name="arrow" className="size-3" />
              </a>
              <a
                className="flex items-center gap-1.5"
                href="https://github.com/web-casa/ImgConvert/releases"
                rel="noreferrer noopener"
                target="_blank"
              >
                Releases
                <NavIcon name="arrow" className="size-3" />
              </a>
            </FooterCol>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-[var(--imgconvert-line)] pt-5 text-xs text-[var(--imgconvert-ink-soft)] md:flex-row md:items-center md:justify-between">
          <span>{copy.commitment}</span>
          <span className="mono">© {new Date().getFullYear()} ImgConvert contributors</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <span className="eyebrow eyebrow-flush text-[0.65rem]">{title}</span>
      {children}
    </div>
  );
}
