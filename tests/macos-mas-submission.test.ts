// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

// @ts-expect-error -- The production CLI intentionally remains a plain ESM script.
const submissionModule = await import("../scripts/submit-macos-mas-pkg.mjs");
const { appStoreCredentials, buildAltoolArgs, parseOptions } = submissionModule;

describe("Mac App Store submission CLI", () => {
  it("validates by default and requires an explicit upload flag", () => {
    expect(parseOptions([])).toEqual({ help: false, pkg: null, upload: false });
    expect(parseOptions(["--pkg=build/ImgConvert.pkg", "--upload"])).toEqual({
      help: false,
      pkg: "build/ImgConvert.pkg",
      upload: true,
    });
  });

  it("rejects unknown arguments and empty package paths", () => {
    expect(() => parseOptions(["--publish"])).toThrow(/unknown argument/);
    expect(() => parseOptions(["--pkg="])).toThrow(/package path is required/);
  });

  it("requires both Apple ID credentials and rejects multiline values", () => {
    expect(() => appStoreCredentials({ APPLE_ID: "publisher@example.com" })).toThrow(
      /APPLE_PASSWORD is required/,
    );
    expect(() =>
      appStoreCredentials({
        APPLE_ID: "publisher@example.com\nsecond@example.com",
        APPLE_PASSWORD: "app-password",
      }),
    ).toThrow(/unsupported characters/);
  });

  it("builds documented altool validation arguments", () => {
    const credentials = {
      appleId: "publisher@example.com",
      password: "app-password",
      provider: "EXAMPLE",
    };
    expect(buildAltoolArgs("validate", "/tmp/ImgConvert.pkg", credentials)).toEqual([
      "altool",
      "--validate-app",
      "-f",
      "/tmp/ImgConvert.pkg",
      "-t",
      "macos",
      "-u",
      "publisher@example.com",
      "-p",
      "app-password",
      "--output-format",
      "xml",
      "--asc-provider",
      "EXAMPLE",
    ]);
  });

  it("builds upload arguments without an optional provider", () => {
    expect(
      buildAltoolArgs("upload", "/tmp/ImgConvert.pkg", {
        appleId: "publisher@example.com",
        password: "app-password",
        provider: null,
      }),
    ).toEqual([
      "altool",
      "--upload-app",
      "-f",
      "/tmp/ImgConvert.pkg",
      "-t",
      "macos",
      "-u",
      "publisher@example.com",
      "-p",
      "app-password",
      "--output-format",
      "xml",
    ]);
  });

  it("rejects unsupported App Store operations", () => {
    expect(() =>
      buildAltoolArgs("delete", "/tmp/ImgConvert.pkg", {
        appleId: "publisher@example.com",
        password: "app-password",
        provider: null,
      }),
    ).toThrow(/unsupported App Store operation/);
  });
});
