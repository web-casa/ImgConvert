import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- Production metadata checker is dependency-free ESM.
const toolModule1 = await import("../scripts/check-extension-availability.mjs");
const { validateExtensionAvailability, verifyRemoteAvailability } = toolModule1;

const unpublished = {
  version: "0.3.1",
  published: true,
  verifiedAt: "2026-09-05",
  browserExtension: { version: null, sourceUrl: null, chromeZipUrl: null, edgeZipUrl: null },
};
describe("extension availability declarations", () => {
  it("keeps both ZIP destinations absent until a public version is recorded", () => {
    expect(() => validateExtensionAvailability(unpublished)).not.toThrow();
    expect(() =>
      validateExtensionAvailability({
        ...unpublished,
        browserExtension: {
          ...unpublished.browserExtension,
          chromeZipUrl: "https://github.com/web-casa/ImgConvert/releases/latest",
        },
      }),
    ).toThrow(/unpublished/);
  });
  it("checks an exact published asset instead of accepting a reachable release landing page", () => {
    const version = "0.3.2";
    const browserExtension = {
      version,
      sourceUrl: null,
      chromeZipUrl: `https://github.com/web-casa/ImgConvert/releases/download/v0.3.1/imgconvert-chrome-mv3-${version}.zip`,
      edgeZipUrl: `https://github.com/web-casa/ImgConvert/releases/download/v0.3.1/imgconvert-edge-mv3-${version}.zip`,
    };
    const release = { ...unpublished, browserExtension };
    expect(() => validateExtensionAvailability(release)).not.toThrow();
    expect(() =>
      verifyRemoteAvailability(release, () => ({ draft: false, tag_name: "v0.3.1", assets: [] })),
    ).toThrow(/not available/);
    expect(() =>
      validateExtensionAvailability({
        ...release,
        browserExtension: {
          ...browserExtension,
          chromeZipUrl: "https://github.com/web-casa/ImgConvert/releases/latest",
        },
      }),
    ).toThrow(/exact verified/);
  });
  it("detects a stale public version even when local declarations agree", () => {
    expect(() =>
      verifyRemoteAvailability(unpublished, () => ({
        draft: false,
        tag_name: "v0.3.2",
        assets: [],
      })),
    ).toThrow(/differs from the latest/);
  });
  it("wires both website download surfaces to availability rather than latest-release fallback", () => {
    const app = readFileSync("website/src/App.svelte", "utf8");
    const content = readFileSync("website/src/lib/content.ts", "utf8");
    expect(content).toContain("publicRelease.browserExtension.chromeZipUrl");
    expect(content).toContain("publicRelease.browserExtension.sourceUrl");
    expect(app.match(/\{#if links.extensionChromeZip\}/gu)).toHaveLength(2);
    expect(app.match(/\{#if links.extensionSource\}/gu)).toHaveLength(2);
    expect(app).not.toContain("extensionAssetPattern");
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts["docs:check"]).toContain("check-extension-availability.mjs");
  });
});
