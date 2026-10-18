// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
// @ts-expect-error -- The production CLI deliberately remains ESM.
import * as updaterManifest from "../scripts/gpui-updater-manifest.mjs";
const { createGpuiManifest, assertLegacyUpdaterVersion } = updaterManifest;
const fixture = () => ({
  version: "0.4.1",
  minimum_system_version: { linux: "5.4", macos: "12.0", windows: "10.0.18362" },
  platforms: {
    "linux-aarch64": {
      url: "https://example.com/test.AppImage",
      signature: "test-signature",
      format: "appimage",
    },
  },
});
describe("separate GPUI updater channel", () => {
  it("keeps the format and compatibility metadata required by both clients", () => {
    const manifest = createGpuiManifest(fixture());
    expect(manifest.platforms["linux-aarch64"].format).toBe("appimage");
    expect(manifest.minimum_system_version.macos).toBe("12.0");
  });
  it("never lets the legacy endpoint advertise the GPUI line", () => {
    expect(() => assertLegacyUpdaterVersion("0.3.2")).not.toThrow();
    expect(() => assertLegacyUpdaterVersion("0.2.99")).toThrow("legacy");
    expect(() => assertLegacyUpdaterVersion("0.4.0")).toThrow("legacy");
    expect(() => assertLegacyUpdaterVersion("1.0.0")).toThrow("legacy");
  });
  it("supplies consistent macOS aliases for old and new SDKs", () => {
    const entry = { url: "https://example.com/test.tar.gz", signature: "signature", format: "app" };
    const value = { ...fixture(), platforms: { "darwin-aarch64": entry } };
    const result = createGpuiManifest(value);
    expect(result.platforms["macos-aarch64"]).toEqual(result.platforms["darwin-aarch64"]);
    expect(() =>
      createGpuiManifest({
        ...value,
        platforms: {
          ...value.platforms,
          "macos-aarch64": { ...entry, signature: "different" },
        },
      }),
    ).toThrow("Conflicting");
  });
  it("rejects missing format and unsafe URLs", () => {
    const value = fixture();
    value.platforms["linux-aarch64"].format = "";
    expect(() => createGpuiManifest(value)).toThrow("format");
    value.platforms["linux-aarch64"].format = "appimage";
    value.platforms["linux-aarch64"].url = "http://example.com/test.AppImage";
    expect(() => createGpuiManifest(value)).toThrow("HTTPS");
  });
  it("fails closed for absent or weakened system requirements", () => {
    const value = fixture();
    value.minimum_system_version.macos = "11.0";
    expect(() => createGpuiManifest(value)).toThrow("baseline");
    value.minimum_system_version.macos = "12.0";
    value.minimum_system_version.linux = "unknown";
    expect(() => createGpuiManifest(value)).toThrow("numeric");
  });
});
