// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  githubApi,
  parseArguments,
  releaseRepository,
  releaseSnapshot,
  requireDraft,
  run,
  validateReleaseTag,
  verifyRemoteTag,
  verifyUnchangedRelease,
} from "./github-release-client.mjs";
import { verifyReleaseEvidence } from "./github-release-evidence.mjs";
import { verifyGithubReleaseChecksums } from "./refresh-github-release-checksums.mjs";
import { verifyCompleteGithubRelease } from "./verify-complete-github-release.mjs";

export async function verifyPublication({
  assetsDir,
  releaseTag,
  sourceSha,
  extensionVersion,
  snapshotPath,
  repository = releaseRepository(),
  api = githubApi,
  execute = run,
}) {
  validateReleaseTag(releaseTag);
  verifyRemoteTag(repository, releaseTag, sourceSha, api);
  const endpoint = `repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`;
  const release = api(endpoint);
  requireDraft(release, releaseTag);
  const snapshot = { ...releaseSnapshot(release), sourceSha };
  mkdirSync(assetsDir); // A fresh directory prevents stale files from satisfying requirements.
  execute("gh", ["release", "download", releaseTag, "--repo", repository, "--dir", assetsDir]);
  const notes = `${assetsDir}-notes.md`;
  writeFileSync(notes, release.body ?? "");
  await verifyGithubReleaseChecksums(assetsDir);
  verifyCompleteGithubRelease({ assetsDir, releaseTag, releaseNotes: notes, extensionVersion });
  await verifyReleaseEvidence({
    assetsDir,
    releaseTag,
    sourceSha,
    extensionVersion,
    repository,
    api,
    execute,
  });
  verifyUnchangedRelease(snapshot, api(endpoint));
  verifyRemoteTag(repository, releaseTag, sourceSha, api);
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`, { flag: "wx" });
  console.log("Complete release bytes and trusted Actions evidence verified");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2), [
      "assets-dir",
      "release-tag",
      "source-sha",
      "extension-version",
      "snapshot",
      "check-snapshot",
    ]);
    const releaseTag = validateReleaseTag(args["release-tag"]);
    if (args["check-snapshot"]) {
      const snapshot = JSON.parse(readFileSync(args["check-snapshot"], "utf8"));
      if (snapshot.tag !== releaseTag) throw new Error("snapshot tag mismatch");
      verifyRemoteTag(releaseRepository(), releaseTag, snapshot.sourceSha);
      verifyUnchangedRelease(
        snapshot,
        githubApi(`repos/${releaseRepository()}/releases/tags/${encodeURIComponent(releaseTag)}`),
      );
    } else {
      await verifyPublication({
        assetsDir: args["assets-dir"],
        releaseTag,
        sourceSha: args["source-sha"],
        extensionVersion: args["extension-version"],
        snapshotPath: args.snapshot,
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
