import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- The production CLI intentionally remains a plain ESM script.
const releaseModule = await import("../scripts/verify-complete-github-release.mjs");
const { verifyCompleteGithubRelease } = releaseModule;

import { createFixture, manifestZip } from "./helpers/github-release-fixture";

describe("complete GitHub Release verification", () => {
  it("accepts the required desktop and browser-extension matrix", () => {
    const fixture = createFixture();
    expect(() => verifyCompleteGithubRelease(fixture)).not.toThrow();
  });

  it("accepts the actual updater alias/signature set and rejects a divergent alias", () => {
    const fixture = createFixture();
    expect(() => verifyCompleteGithubRelease(fixture)).not.toThrow();
    const sums = path.join(fixture.assetsDir, "SHA256SUMS");
    writeFileSync(
      sums,
      readFileSync(sums, "utf8").replace(
        /^[a-f0-9]{64}( {2}ImgConvert-1\.2\.3-x86_64\.AppImage)$/m,
        `${"a".repeat(64)}$1`,
      ),
    );
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(/alias must have the same digest/);
  });

  it.each(["ImgConvert_1.2.3_extra.deb", "unreviewed.zip", "ImgConvert_1.2.3_aarch64.dmg"])(
    "rejects extra asset %s even when checksummed",
    (name) => {
      expect(() => verifyCompleteGithubRelease(createFixture([], [name]))).toThrow(
        /unexpected release asset/,
      );
    },
  );

  it.each([
    "latest.json",
    "ImgConvert_1.2.3_amd64.AppImage.sig",
    "release-evidence-macos-arm64.json",
  ])("requires auxiliary release asset %s", (name) => {
    expect(() => verifyCompleteGithubRelease(createFixture([name]))).toThrow(
      /missing required release asset/,
    );
  });

  it("rejects a release missing one Windows architecture", () => {
    const fixture = createFixture(["ImgConvert_1.2.3_arm64-setup.exe"]);
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(
      /Windows release requires exactly one ImgConvert_1.2.3_arm64-setup.exe/,
    );
  });

  it("rejects a release missing the Chrome extension ZIP", () => {
    const fixture = createFixture(["imgconvert-chrome-mv3-0.3.2.zip"]);
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(/chrome extension ZIP/);
  });

  it("does not let one ambiguously named installer satisfy two architectures", () => {
    const fixture = createFixture(
      ["ImgConvert_1.2.3_x64_en-US.msi", "ImgConvert_1.2.3_arm64_en-US.msi"],
      ["ImgConvert_1.2.3_x64_arm64.msi"],
    );
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(/Windows release requires/);
  });

  it("rejects release notes without the unsigned SmartScreen warning", () => {
    const fixture = createFixture();
    writeFileSync(fixture.releaseNotes, "Routine release notes.\n");
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(/SmartScreen/);
  });
  it.each(["x64", "arm64"])("requires the Chinese MSI for %s", (arch) => {
    expect(() =>
      verifyCompleteGithubRelease(createFixture([`ImgConvert_1.2.3_${arch}_zh-CN.msi`])),
    ).toThrow(/Windows release requires/);
  });

  it.each([
    "ImgConvert_1.2.30_x64_zh-CN.msi",
    "ImgConvert_1.2.3_x64_fr-FR.msi",
    "ImgConvert_1.2.3_x64_en-US-copy.msi",
  ])("rejects unexpected installer %s", (name) => {
    expect(() => verifyCompleteGithubRelease(createFixture([], [name]))).toThrow(
      /unexpected Windows installer/,
    );
  });

  it("validates the same bilingual matrix through the Windows finalizer CLI", () => {
    const fixture = createFixture();
    for (const name of ["en-US", "zh-CN"]) {
      expect(
        JSON.parse(readFileSync("src-tauri/tauri.windows.conf.json", "utf8")).bundle.windows.wix
          .language,
      ).toContain(name);
    }
    const staged = path.join(path.dirname(fixture.assetsDir), "windows");
    mkdirSync(staged);
    for (const arch of ["x64", "arm64"]) {
      for (const suffix of ["_en-US.msi", "_zh-CN.msi", "-setup.exe"]) {
        writeFileSync(path.join(staged, `ImgConvert_1.2.3_${arch}${suffix}`), "installer fixture");
      }
    }
    const run = () =>
      spawnSync(
        process.execPath,
        ["scripts/windows-release-assets.mjs", `--assets-dir=${staged}`, "--release-tag=v1.2.3"],
        { encoding: "utf8" },
      );
    expect(run().status).toBe(0);
    rmSync(path.join(staged, "ImgConvert_1.2.3_arm64_zh-CN.msi"));
    expect(run().status).not.toBe(0);
  });

  it("rejects mutually different extension versions even with matching checksums", () => {
    const fixture = createFixture(
      ["imgconvert-chrome-mv3-0.3.2.zip", "imgconvert-edge-mv3-0.3.2.zip"],
      ["imgconvert-chrome-mv3-9.9.9.zip", "imgconvert-edge-mv3-8.8.8.zip"],
    );
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(
      /extension ZIP must match tagged version/,
    );
  });

  it("requires the explicitly tagged extension version independently of desktop version", () => {
    const fixture = createFixture();
    expect(() => verifyCompleteGithubRelease({ ...fixture, extensionVersion: "0.3.1" })).toThrow(
      /extension ZIP/,
    );
    expect(() => verifyCompleteGithubRelease({ ...fixture, extensionVersion: undefined })).toThrow(
      /extension version/,
    );
  });

  it.each(["8.8.8", "0.3.2"])("rejects a mismatched or duplicate manifest (%s)", (version) => {
    const fixture = createFixture();
    const zip = manifestZip(version);
    writeFileSync(
      path.join(fixture.assetsDir, "imgconvert-chrome-mv3-0.3.2.zip"),
      version === "0.3.2" ? manifestZip(version, 0, true) : zip,
    );
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(/manifest version|duplicate/);
  });

  it("rejects a corrupt or oversized decompressed manifest", () => {
    const fixture = createFixture();
    const zipPath = path.join(fixture.assetsDir, "imgconvert-chrome-mv3-0.3.2.zip");
    writeFileSync(zipPath, "not a zip");
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(/ZIP/);
    writeFileSync(zipPath, manifestZip("0.3.2", 8, false, "x".repeat(70_000)));
    expect(() => verifyCompleteGithubRelease(fixture)).toThrow(/oversized extension manifest/);
  });
});
