import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { baseOptions } from "@/lib/layout.shared";
import { getDocsLocale } from "@/lib/locale-routing";
import { source } from "@/lib/source";

type LayoutProps = {
  children: ReactNode;
  params: Promise<{
    lang: string;
  }>;
};

export default async function Layout({ children, params }: LayoutProps) {
  const locale = getDocsLocale((await params).lang);

  if (!locale) {
    notFound();
  }

  return (
    <DocsLayout {...baseOptions(locale)} tree={source.getPageTree(locale)}>
      {children}
    </DocsLayout>
  );
}
