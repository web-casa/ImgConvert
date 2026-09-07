import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- Production release tools are plain ESM.
const toolModule1 = await import("../scripts/append-github-release-assets.mjs");
const { appendGithubReleaseAssets } = toolModule1;
// @ts-expect-error -- Production release tools are plain ESM.
const toolModule2 = await import("../scripts/refresh-github-release-checksums.mjs");
const { refreshGithubReleaseChecksums, verifyGithubReleaseChecksums } = toolModule2;
// @ts-expect-error -- Production release tools are plain ESM.
const toolModule3 = await import("../scripts/github-release-client.mjs");
const { releaseSnapshot, verifyUnchangedRelease, verifyRemoteTag } = toolModule3;

describe("append-only release checksum continuity", () => {
  it("resolves annotated remote tags and rejects a moved tag before publication", () => {
    const repository = "web-casa/ImgConvert";
    const sourceSha = "a".repeat(40);
    const tagSha = "b".repeat(40);
    const api = (endpoint: string) =>
      endpoint.includes("/git/ref/")
        ? { ref: "refs/tags/v1.2.3", object: { type: "tag", sha: tagSha } }
        : { object: { type: "commit", sha: sourceSha } };
    expect(() => verifyRemoteTag(repository, "v1.2.3", sourceSha, api)).not.toThrow();
    expect(() => verifyRemoteTag(repository, "v1.2.3", "c".repeat(40), api)).toThrow(/tag changed/);
  });

  it.each([
    "valid",
    "corrupt-before",
    "old-replaced",
    "new-replaced",
    "unexpected-added",
    "old-sums-replaced",
  ])("handles %s across real checksum and merge code", async (mode) => {
    const root = mkdtempSync(path.join(tmpdir(), "imgconvert-append-test-"));
    try {
      const remote = path.join(root, "remote");
      const staged = path.join(root, "staged");
      mkdirSync(remote);
      mkdirSync(staged);
      writeFileSync(path.join(remote, "old.dmg"), "previously verified DMG");
      await refreshGithubReleaseChecksums(remote);
      writeFileSync(path.join(staged, "new.zip"), "new verified ZIP");
      if (mode === "corrupt-before") writeFileSync(path.join(remote, "old.dmg"), "corrupted");
      const uploads: string[][] = [];
      const api = () => ({
        id: 1,
        tag_name: "v1.2.3",
        draft: true,
        body: "release notes",
        assets: readdirSync(remote).map((name, index) => {
          const bytes = readFileSync(path.join(remote, name));
          return {
            id: index + 1,
            name,
            size: bytes.length,
            updated_at: "2026-09-05",
            digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          };
        }),
      });
      // Keep IDs stable when an asset is appended; GitHub asset IDs do not depend on sorting.
      const stableApi = () => {
        const result = api();
        return { ...result, assets: result.assets.map((asset) => ({ ...asset, id: asset.name })) };
      };
      const execute = (command: string, args: string[]) => {
        expect(command).toBe("gh");
        if (args[1] === "download") {
          const target = args[args.indexOf("--dir") + 1];
          for (const name of readdirSync(remote))
            copyFileSync(path.join(remote, name), path.join(target, name));
        } else if (args[1] === "upload") {
          uploads.push(args);
          for (const file of args
            .slice(3, args.indexOf("--repo"))
            .filter((arg) => arg !== "--clobber"))
            copyFileSync(file, path.join(remote, path.basename(file)));
          if (!args.includes("--clobber")) {
            if (mode === "old-replaced") writeFileSync(path.join(remote, "old.dmg"), "replacement");
            if (mode === "new-replaced") writeFileSync(path.join(remote, "new.zip"), "replacement");
            if (mode === "unexpected-added")
              writeFileSync(path.join(remote, "extra.deb"), "unexpected");
            if (mode === "old-sums-replaced")
              writeFileSync(path.join(remote, "SHA256SUMS"), "replacement\n");
          }
        } else throw new Error("unexpected command");
        return "";
      };
      const operation = appendGithubReleaseAssets({
        assetsDir: staged,
        releaseTag: "v1.2.3",
        repository: "web-casa/ImgConvert",
        api: stableApi,
        execute,
      });
      if (mode === "valid") {
        await expect(operation).resolves.toBeUndefined();
        await expect(verifyGithubReleaseChecksums(remote)).resolves.toBeDefined();
        expect(uploads).toHaveLength(2);
      } else {
        await expect(operation).rejects.toThrow();
        expect(uploads.some((args) => args.includes("--clobber"))).toBe(false);
        if (mode === "corrupt-before") expect(uploads).toHaveLength(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects last-minute attachment replacement, note changes and publication", () => {
    const release = {
      id: 1,
      tag_name: "v1.2.3",
      draft: true,
      body: "unsigned SmartScreen",
      assets: [{ id: 2, name: "a.dmg", size: 9, updated_at: "today" }],
    };
    const snapshot = releaseSnapshot(release);
    expect(() => verifyUnchangedRelease(snapshot, { ...release, body: "removed warning" })).toThrow(
      /notes changed/,
    );
    expect(() =>
      verifyUnchangedRelease(snapshot, { ...release, assets: [{ ...release.assets[0], id: 3 }] }),
    ).toThrow(/asset changed/);
    expect(() => verifyUnchangedRelease(snapshot, { ...release, draft: false })).toThrow(
      /remain a draft/,
    );
  });
});
