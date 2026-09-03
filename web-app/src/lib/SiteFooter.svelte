<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (C) 2026 ImgConvert contributors -->
<script lang="ts">
  import appIconUrl from "../../../src/lib/assets/app-icon.png";
  import type { Locale } from "./copy";
  import {
    externalSiteLinks,
    localizedContentPage,
    localizedHome,
    localizedHomeSection,
    localizedWebApp,
  } from "./site-links";
  import type { Copy } from "./workbench";

  let { copy, locale }: { copy: Copy; locale: Locale } = $props();
</script>

<footer class="app-footer">
  <div class="app-footer-container app-footer-grid">
    <div>
      <a
        class="app-brand"
        href={localizedHome(locale)}
        aria-label={copy.header.home}
        translate="no"
      >
        <img src={appIconUrl} alt="" width="30" height="30" aria-hidden="true" />
        <span>ImgConvert</span>
      </a>
      <p>{copy.footer.tagline}</p>
    </div>
    <nav aria-label={copy.footer.linksLabel}>
      <a href={localizedHomeSection(locale, "guides")}>{copy.footer.guides}</a>
      <a href={localizedContentPage(locale, "docs")}>{copy.footer.docs}</a>
      <a href={localizedContentPage(locale, "blog")}>{copy.footer.blog}</a>
      <a href={localizedContentPage(locale, "privacy")}>{copy.footer.privacy}</a>
      <a href={localizedContentPage(locale, "legal")}>{copy.footer.legal}</a>
      <a href={localizedWebApp(locale)} aria-current="page">{copy.footer.webApp}</a>
      <a href={externalSiteLinks.macAppStore} target="_blank" rel="noreferrer"
        >{copy.footer.macStore}</a
      >
      <a href={externalSiteLinks.microsoftStore} target="_blank" rel="noreferrer"
        >{copy.footer.store}</a
      >
      <a href={externalSiteLinks.repository} target="_blank" rel="noreferrer"
        >{copy.footer.repository}</a
      >
      <a href="#top">{copy.footer.back} ↑</a>
    </nav>
  </div>
</footer>
