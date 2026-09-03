import { describe, expect, it } from "vitest";

import {
  links as websiteLinks,
  masUrl as websiteMasUrl,
  storeUrl as websiteStoreUrl,
  translations as websiteCopy,
} from "../../website/src/lib/content";
import { homeContent } from "../../website/src/lib/home";
import { translations as webAppCopy } from "../src/lib/copy";
import {
  externalSiteLinks,
  localizedContentPage,
  localizedHome,
  localizedHomeSection,
  localizedWebApp,
} from "../src/lib/site-links";

describe("shared site chrome links", () => {
  it.each(["zh", "en"] as const)("matches the %s homepage navigation copy", (locale) => {
    expect(webAppCopy[locale].header).toMatchObject({
      download: websiteCopy[locale].nav.download,
      faq: homeContent[locale].nav.faq,
      formats: homeContent[locale].nav.formats,
      github: homeContent[locale].nav.github,
      guides: homeContent[locale].nav.guides,
      home: homeContent[locale].nav.homeLabel,
      languageLabel: homeContent[locale].nav.languageLabel,
      primaryLabel: homeContent[locale].nav.primaryLabel,
      product: homeContent[locale].nav.product,
      webApp: homeContent[locale].nav.webApp,
    });
  });

  it.each(["zh", "en"] as const)("matches the %s homepage footer copy", (locale) => {
    expect(webAppCopy[locale].footer).toMatchObject({
      back: websiteCopy[locale].footer.back,
      blog: websiteCopy[locale].footer.blog,
      docs: websiteCopy[locale].footer.docs,
      guides: websiteCopy[locale].footer.guides,
      legal: websiteCopy[locale].footer.legal,
      linksLabel: homeContent[locale].nav.footerLabel,
      macStore: websiteCopy[locale].footer.macStore,
      privacy: websiteCopy[locale].footer.privacy,
      repository: websiteCopy[locale].footer.repository,
      store: websiteCopy[locale].footer.store,
      tagline: websiteCopy[locale].footer.tagline,
      webApp: websiteCopy[locale].footer.webApp,
    });
  });

  it("keeps homepage sections localized from the Web app", () => {
    expect(localizedHome("zh")).toBe("/");
    expect(localizedHome("en")).toBe("/en/");
    expect(localizedHomeSection("zh", "download")).toBe("/#download");
    expect(localizedHomeSection("en", "features")).toBe("/en/#features");
  });

  it("keeps content pages and the Web app locale-aware", () => {
    expect(localizedContentPage("zh", "privacy")).toBe("/privacy/");
    expect(localizedContentPage("en", "docs")).toBe("/en/docs/");
    expect(localizedWebApp("zh")).toBe("/convert/?lang=zh");
    expect(localizedWebApp("en")).toBe("/convert/?lang=en");
  });

  it("uses the published store and repository destinations", () => {
    expect(externalSiteLinks.macAppStore).toBe(websiteMasUrl);
    expect(externalSiteLinks.microsoftStore).toBe(websiteStoreUrl);
    expect(externalSiteLinks.repository).toBe(websiteLinks.repository);
  });
});
