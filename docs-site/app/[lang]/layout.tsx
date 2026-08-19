import "../global.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DocsProvider } from "@/components/docs-provider";
import { SiteFooter } from "@/components/footer";
import { docsLocales, getDocsLocale } from "@/lib/locale-routing";

type RootLayoutProps = {
  children: ReactNode;
  params: Promise<{
    lang: string;
  }>;
};

export function generateStaticParams() {
  return docsLocales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: RootLayoutProps): Promise<Metadata> {
  const locale = getDocsLocale((await params).lang);

  if (!locale) {
    notFound();
  }

  const description =
    locale === "zh-CN"
      ? "ImgConvert 的发布、架构、格式能力与开发文档。"
      : "Documentation for ImgConvert releases, architecture, format support, and development.";

  return {
    title: {
      default: "ImgConvert Docs",
      template: "%s | ImgConvert Docs",
    },
    description,
  };
}

export default async function RootLayout({ children, params }: RootLayoutProps) {
  const locale = getDocsLocale((await params).lang);

  if (!locale) {
    notFound();
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans">
        <DocsProvider locale={locale}>
          <div className="flex flex-1 flex-col">
            <div className="flex-1">{children}</div>
            <SiteFooter locale={locale} />
          </div>
        </DocsProvider>
      </body>
    </html>
  );
}
