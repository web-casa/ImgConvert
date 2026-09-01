// SPDX-License-Identifier: Apache-2.0

import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export const EXTERNAL_LINKS = {
  website: "https://imgconvert.web.casa/",
  repository: "https://github.com/web-casa/ImgConvert",
  support: "https://github.com/web-casa/ImgConvert/issues",
} as const;

export type ExternalLinkUrl = (typeof EXTERNAL_LINKS)[keyof typeof EXTERNAL_LINKS];

/** Opens one of ImgConvert's fixed, capability-allowlisted links in the default browser. */
export async function openExternalUrl(url: ExternalLinkUrl): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
    return;
  }

  // Browsers commonly return `null` when `noopener` is passed to window.open,
  // even when the tab opened successfully. Open a same-origin blank tab,
  // sever its opener synchronously, then navigate it so popup-block failures
  // stay distinguishable without exposing the app to reverse tabnabbing.
  const opened = window.open("about:blank", "_blank");
  if (!opened) throw new Error("external link window blocked");
  opened.opener = null;
  opened.location.replace(url);
}
