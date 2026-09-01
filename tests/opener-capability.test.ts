// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const externalLinkMocks = vi.hoisted(() => ({
  tauri: false,
  openUrl: vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => externalLinkMocks.tauri,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: externalLinkMocks.openUrl,
}));

import { EXTERNAL_LINKS, openExternalUrl } from "../src/lib/external-links";

interface CapabilityPermission {
  identifier?: string;
  allow?: Array<{ url?: string }>;
}

describe("external-link capability guardrail", () => {
  beforeEach(() => {
    externalLinkMocks.tauri = false;
    externalLinkMocks.openUrl.mockClear();
  });

  it("allows exactly the fixed links exposed by the frontend", () => {
    const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8")) as {
      permissions?: Array<string | CapabilityPermission>;
    };
    const opener = capability.permissions?.find(
      (permission): permission is CapabilityPermission =>
        typeof permission !== "string" && permission.identifier === "opener:allow-open-url",
    );
    const allowedUrls = (opener?.allow ?? []).flatMap(({ url }) => (url ? [url] : [])).sort();

    expect(allowedUrls).toEqual(Object.values(EXTERNAL_LINKS).sort());
    expect(allowedUrls.every((url) => url.startsWith("https://"))).toBe(true);
    expect(allowedUrls.some((url) => url.includes("*"))).toBe(false);
  });

  it("delegates allowlisted links to the native opener in Tauri", async () => {
    externalLinkMocks.tauri = true;

    await openExternalUrl(EXTERNAL_LINKS.website);

    expect(externalLinkMocks.openUrl).toHaveBeenCalledWith(EXTERNAL_LINKS.website);
  });

  it("severs the opener before navigating a web-preview tab", async () => {
    const replace = vi.fn();
    const opened = { opener: window, location: { replace } };
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);

    await openExternalUrl(EXTERNAL_LINKS.repository);

    expect(windowOpen).toHaveBeenCalledWith("about:blank", "_blank");
    expect(opened.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith(EXTERNAL_LINKS.repository);
    windowOpen.mockRestore();
  });

  it("reports a blocked web-preview popup", async () => {
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);

    await expect(openExternalUrl(EXTERNAL_LINKS.website)).rejects.toThrow(
      "external link window blocked",
    );
    windowOpen.mockRestore();
  });
});
