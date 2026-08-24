import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error -- The production CLI intentionally remains a plain ESM script.
const checksumModule = await import("../scripts/refresh-github-release-checksums.mjs");
const { parseOptions, refreshGithubReleaseChecksums, verifyGithubReleaseChecksums } =
  checksumModule;

const fixtureDirectories: string[] = [];

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("GitHub Release checksum refresh", () => {
  it("rebuilds a flat manifest without including its previous contents", async () => {
    const directory = fixtureDirectory();
    writeFileSync(path.join(directory, "zeta.bin"), "zeta");
    writeFileSync(path.join(directory, "alpha.txt"), "alpha");
    writeFileSync(path.join(directory, "SHA256SUMS"), "stale manifest\n");

    const result = await refreshGithubReleaseChecksums(directory);

    expect(result.files).toEqual(["alpha.txt", "zeta.bin"]);
    expect(readFileSync(result.outputPath, "utf8")).toBe(
      `${sha256("alpha")}  alpha.txt\n${sha256("zeta")}  zeta.bin\n`,
    );
    await expect(verifyGithubReleaseChecksums(directory)).resolves.toMatchObject({
      files: ["alpha.txt", "zeta.bin"],
    });
  });

  it("rejects symlinked release assets", async () => {
    const directory = fixtureDirectory();
    writeFileSync(path.join(directory, "safe.bin"), "safe");
    symlinkSync(path.join(directory, "safe.bin"), path.join(directory, "linked.bin"));

    await expect(refreshGithubReleaseChecksums(directory)).rejects.toThrow(/regular file/);
  });

  it("rejects unsafe release asset names", async () => {
    const directory = fixtureDirectory();
    writeFileSync(path.join(directory, "not safe.bin"), "unsafe");

    await expect(refreshGithubReleaseChecksums(directory)).rejects.toThrow(
      /unsafe release asset name/,
    );
  });

  it("requires an explicit asset directory", () => {
    expect(() => parseOptions([])).toThrow(/assets-dir/);
    expect(parseOptions(["--assets-dir=release-assets"])).toMatchObject({
      assetsDir: "release-assets",
    });
    expect(parseOptions(["--assets-dir=release-assets", "--verify"])).toMatchObject({
      verify: true,
    });
  });

  it("rejects a manifest that omits a downloaded asset", async () => {
    const directory = fixtureDirectory();
    writeFileSync(path.join(directory, "alpha.txt"), "alpha");
    await refreshGithubReleaseChecksums(directory);
    writeFileSync(path.join(directory, "later.bin"), "later");

    await expect(verifyGithubReleaseChecksums(directory)).rejects.toThrow(/exactly/);
  });

  it("rejects a modified downloaded asset", async () => {
    const directory = fixtureDirectory();
    const asset = path.join(directory, "alpha.txt");
    writeFileSync(asset, "alpha");
    await refreshGithubReleaseChecksums(directory);
    writeFileSync(asset, "modified");

    await expect(verifyGithubReleaseChecksums(directory)).rejects.toThrow(/hash mismatch/);
  });
});

function fixtureDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "imgconvert-release-checksums-"));
  fixtureDirectories.push(directory);
  return directory;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
