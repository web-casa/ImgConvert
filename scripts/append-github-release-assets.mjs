// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeAssets,
  githubApi,
  parseArguments,
  releaseRepository,
  releaseSnapshot,
  requireDraft,
  run,
  validateReleaseTag,
  verifyUnchangedRelease,
} from "./github-release-client.mjs";
import {
  refreshGithubReleaseChecksums,
  verifyGithubReleaseChecksums,
} from "./refresh-github-release-checksums.mjs";

export async function verifyAssetMerge(existingDir, additionsDir, downloadedDir) {
  await verifyGithubReleaseChecksums(existingDir);
  const existing = await describeAssets(existingDir);
  const additions = await describeAssets(additionsDir);
  const names = new Set(existing.map((asset) => asset.name));
  if (additions.some((asset) => names.has(asset.name))) throw new Error("Release asset collision");
  const expected = [...existing, ...additions].sort(byName);
  const downloaded = await describeAssets(downloadedDir);
  if (JSON.stringify(expected) !== JSON.stringify(downloaded))
    throw new Error("Release bytes changed while appending assets");
  if (
    !readFileSync(path.join(existingDir, "SHA256SUMS")).equals(
      readFileSync(path.join(downloadedDir, "SHA256SUMS")),
    )
  ) {
    throw new Error("Previous SHA256SUMS changed while appending assets");
  }
}

function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// Append-only for packages. The old checksum remains the authority until every
// old byte AND every staged new byte has survived the round trip unchanged.
export async function appendGithubReleaseAssets({
  assetsDir,
  releaseTag,
  repository,
  api = githubApi,
  execute = run,
}) {
  repository = releaseRepository(repository);
  validateReleaseTag(releaseTag);
  if (existsSync(path.join(assetsDir, "SHA256SUMS")))
    throw new Error("staged additions must not supply SHA256SUMS");
  const additions = await describeAssets(assetsDir);
  const endpoint = `repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`;
  const initial = api(endpoint);
  requireDraft(initial, releaseTag);
  const snapshot = releaseSnapshot(initial);
  for (const asset of additions) {
    if (snapshot.assets.some((old) => old.name === asset.name))
      throw new Error(`Release already has ${asset.name}`);
  }
  const root = mkdtempSync(path.join(tmpdir(), "imgconvert-release-append-"));
  const existing = path.join(root, "existing");
  const merged = path.join(root, "merged");
  mkdirSync(existing);
  mkdirSync(merged);
  try {
    execute("gh", ["release", "download", releaseTag, "--repo", repository, "--dir", existing]);
    await verifyGithubReleaseChecksums(existing);
    verifyUnchangedRelease(snapshot, api(endpoint));
    execute("gh", [
      "release",
      "upload",
      releaseTag,
      ...additions.map(({ name }) => path.join(assetsDir, name)),
      "--repo",
      repository,
    ]);
    const afterUpload = api(endpoint);
    verifyUnchangedRelease(snapshot, afterUpload, { allowAdded: true });
    execute("gh", ["release", "download", releaseTag, "--repo", repository, "--dir", merged]);
    await verifyAssetMerge(existing, assetsDir, merged);
    if (afterUpload.assets.length !== readdirSync(merged).length)
      throw new Error("Remote release asset set changed during append");
    await refreshGithubReleaseChecksums(merged);
    await verifyGithubReleaseChecksums(merged);
    const mergedSnapshot = releaseSnapshot(afterUpload);
    verifyUnchangedRelease(mergedSnapshot, api(endpoint));
    execute("gh", [
      "release",
      "upload",
      releaseTag,
      path.join(merged, "SHA256SUMS"),
      "--clobber",
      "--repo",
      repository,
    ]);
    verifyUnchangedRelease(mergedSnapshot, api(endpoint), { ignoreChecksum: true });
    console.log(`Verified and appended ${additions.length} release assets; Release remains draft`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2), ["assets-dir", "release-tag"]);
    await appendGithubReleaseAssets({
      assetsDir: args["assets-dir"],
      releaseTag: args["release-tag"],
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
