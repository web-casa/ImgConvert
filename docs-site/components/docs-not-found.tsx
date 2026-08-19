"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { getDocsLocale, localePath } from "@/lib/locale-routing";

export function DocsNotFound() {
  const params = useParams<{ lang?: string | string[] }>();
  const candidate = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const locale = getDocsLocale(candidate ?? "") ?? "zh-CN";
  const copy =
    locale === "en-US"
      ? {
          action: "Open the documentation",
          description:
            "This documentation page is not available in English yet, or its address has changed.",
          title: "Page not found",
        }
      : {
          action: "打开文档首页",
          description: "该文档不存在、地址已变更，或暂不可用。",
          title: "未找到页面",
        };

  return (
    <main className="mx-auto flex min-h-[55vh] max-w-3xl flex-col justify-center px-6 py-20">
      <span className="eyebrow mb-4">404</span>
      <h1 className="text-4xl font-semibold tracking-tight">{copy.title}</h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-[var(--imgconvert-ink-soft)]">
        {copy.description}
      </p>
      <div className="mt-8">
        <Link className="btn-primary" href={localePath(locale, "/docs")}>
          {copy.action}
        </Link>
      </div>
    </main>
  );
}
