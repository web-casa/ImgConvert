// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const project = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
  version: string;
};
const temporaryRoots: string[] = [];

function report(targetRoot: string, scope: "github" | "all" = "all") {
  const output = execFileSync(
    process.execPath,
    ["scripts/report-release-readiness.mjs", `--scope=${scope}`, "--json"],
    {
      cwd: path.resolve("."),
      env: { ...process.env, CARGO_TARGET_DIR: targetRoot },
      encoding: "utf8",
    },
  );
  return JSON.parse(output) as {
    artifacts: Array<{ id: string; status: string }>;
  };
}

function artifactStatus(result: ReturnType<typeof report>, id: string): string | undefined {
  return result.artifacts.find((artifact) => artifact.id === id)?.status;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release readiness artifacts", () => {
  it("rejects stale desktop installers and an empty app bundle", () => {
    const root = mkdtempSync(path.join(tmpdir(), "imgconvert-readiness-stale-"));
    temporaryRoots.push(root);
    const bundle = path.join(root, "release", "bundle");
    for (const directory of ["dmg", "msi", "nsis", "macos/ImgConvert.app"]) {
      mkdirSync(path.join(bundle, directory), { recursive: true });
    }
    writeFileSync(path.join(bundle, "dmg", "ImgConvert_0.0.1.dmg"), "stale");
    writeFileSync(path.join(bundle, "msi", "ImgConvert_0.0.1.msi"), "stale");
    writeFileSync(path.join(bundle, "nsis", "ImgConvert_0.0.1.exe"), "stale");
    mkdirSync(path.join(bundle, "dmg", `ImgConvert_${project.version}.dmg`));
    writeFileSync(path.join(bundle, "dmg", `ImgConvert_${project.version}_x64.dmg`), "one-arch");
    writeFileSync(path.join(bundle, "msi", `ImgConvert_${project.version}_x64.msi`), "one-arch");
    writeFileSync(path.join(bundle, "nsis", `ImgConvert_${project.version}_x64.exe`), "one-arch");
    writeFileSync(path.join(bundle, "msi", `ImgConvert_${project.version}0_x64.msi`), "near");
    writeFileSync(path.join(bundle, "nsis", `ImgConvert_1${project.version}_x64.exe`), "near");

    const result = report(root);

    expect(artifactStatus(result, "macos-dmg")).toBe("missing");
    expect(artifactStatus(result, "windows-msi")).toBe("missing");
    expect(artifactStatus(result, "windows-nsis")).toBe("missing");
    expect(artifactStatus(result, "macos-mas-app")).toBe("missing");
  });

  it("recognizes current non-empty desktop artifacts and keeps them in GitHub scope", () => {
    const root = mkdtempSync(path.join(tmpdir(), "imgconvert-readiness-current-"));
    temporaryRoots.push(root);
    const bundle = path.join(root, "release", "bundle");
    for (const directory of ["dmg", "msi", "nsis", "macos/ImgConvert.app/Contents/MacOS"]) {
      mkdirSync(path.join(bundle, directory), { recursive: true });
    }
    for (const architecture of ["x64", "arm64"]) {
      writeFileSync(
        path.join(bundle, "dmg", `ImgConvert_${project.version}_${architecture}.dmg`),
        "dmg",
      );
      writeFileSync(
        path.join(bundle, "msi", `ImgConvert_${project.version}_${architecture}.msi`),
        "msi",
      );
      writeFileSync(
        path.join(bundle, "nsis", `ImgConvert_${project.version}_${architecture}.exe`),
        "exe",
      );
    }
    const appContents = path.join(bundle, "macos", "ImgConvert.app", "Contents");
    writeFileSync(
      path.join(appContents, "Info.plist"),
      `<plist><dict><key>CFBundleShortVersionString</key><string>${project.version}</string></dict></plist>`,
    );
    writeFileSync(path.join(appContents, "MacOS", "ImgConvert"), "binary");

    const all = report(root, "all");
    expect(artifactStatus(all, "macos-dmg")).toBe("ready");
    expect(artifactStatus(all, "windows-msi")).toBe("ready");
    expect(artifactStatus(all, "windows-nsis")).toBe("ready");
    expect(artifactStatus(all, "macos-mas-app")).toBe("ready");

    const github = report(root, "github");
    expect(artifactStatus(github, "macos-dmg")).toBe("ready");
    expect(artifactStatus(github, "windows-msi")).toBe("ready");
    expect(artifactStatus(github, "windows-nsis")).toBe("ready");
  });
});
