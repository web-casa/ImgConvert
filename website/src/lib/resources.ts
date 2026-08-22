// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import resourceData from "../../content/resources.json";
import type { Locale } from "./content";

export type ResourceKind = "blog" | "docs";
export type ResourceVisual = "format-picker" | "live-workspace" | "privacy-editorial";

export type ResourceSection = {
  heading: string;
  paragraphs: string[];
  list?: string[];
};

export type ResourceQuestion = {
  question: string;
  answer: string;
};

export type ResourcePage = {
  id: string;
  kind: ResourceKind;
  slug: string;
  eyebrow: string;
  label: string;
  title: string;
  lede: string;
  description: string;
  keywords: string[];
  readingTime: string;
  visual?: ResourceVisual;
  takeaways: string[];
  sections: ResourceSection[];
  callout: {
    title: string;
    body: string;
  };
  questions: ResourceQuestion[];
  related: string[];
};

export type ResourceHub = {
  kind: ResourceKind;
  eyebrow: string;
  title: string;
  lede: string;
  description: string;
  keywords: string[];
  indexTitle: string;
  indexBody: string;
};

export type ResourceCommon = {
  home: string;
  blog: string;
  docs: string;
  guides: string;
  privacy: string;
  language: string;
  navigation: string;
  skip: string;
  breadcrumbHome: string;
  read: string;
  open: string;
  takeaways: string;
  faq: string;
  related: string;
  download: string;
  localNote: string;
  formatVisualAlt: string;
  formatVisualCaption: string;
  workspaceVisualAlt: string;
  workspaceVisualCaption: string;
  privacyVisualAlt: string;
  privacyVisualCaption: string;
};

type ResourceLocale = {
  common: ResourceCommon;
  hubs: Record<ResourceKind, ResourceHub>;
  pages: Record<string, ResourcePage>;
};

export const resources = resourceData as Record<Locale, ResourceLocale>;

export function hubPath(locale: Locale, kind: ResourceKind): string {
  return locale === "zh" ? `/${kind}/` : `/en/${kind}/`;
}

export function resourcePath(locale: Locale, id: string): string {
  const page = resources[locale].pages[id];
  if (!page) return hubPath(locale, "docs");

  return locale === "zh" ? `/${page.kind}/${page.slug}/` : `/en/${page.kind}/${page.slug}/`;
}

export function resourcePages(locale: Locale, kind: ResourceKind): ResourcePage[] {
  return Object.values(resources[locale].pages).filter((page) => page.kind === kind);
}
