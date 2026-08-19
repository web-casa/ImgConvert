import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findNeighbour } from "fumadocs-core/page-tree";
import { createRelativeLink } from "fumadocs-ui/mdx";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";

import { getMDXComponents } from "@/components/mdx";
import { getDocsLocale } from "@/lib/locale-routing";
import { source } from "@/lib/source";

type PageProps = {
  params: Promise<{
    lang: string;
    slug?: string[];
  }>;
};

export default async function Page(props: PageProps) {
  const params = await props.params;
  const locale = getDocsLocale(params.lang);

  if (!locale) {
    notFound();
  }

  const page = source.getPage(params.slug, locale);

  if (!page) {
    notFound();
  }

  const MDX = page.data.body;
  const footerItems = findNeighbour(source.getPageTree(locale), page.url);
  const canonicalPolicy = isCanonicalPolicyPage(page.path);

  return (
    <DocsPage footer={{ items: footerItems }} toc={page.data.toc}>
      {!canonicalPolicy && <DocsTitle>{page.data.title}</DocsTitle>}
      {!canonicalPolicy && <DocsDescription>{page.data.description}</DocsDescription>}
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const locale = getDocsLocale(params.lang);

  if (!locale) {
    notFound();
  }

  const page = source.getPage(params.slug, locale);

  if (!page) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
  };
}

function isCanonicalPolicyPage(path: string): boolean {
  return path === "privacy.mdx" || path === "privacy.en-US.mdx";
}
