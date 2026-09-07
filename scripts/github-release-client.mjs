// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";
import { collectReleaseAssets, sha256File } from "./refresh-github-release-checksums.mjs";

export function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 300_000,
  });
}

export function githubApi(endpoint) {
  return JSON.parse(run("gh", ["api", endpoint]));
}

export function releaseRepository(value = process.env.GITHUB_REPOSITORY) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value ?? "")) {
    throw new Error("a valid GITHUB_REPOSITORY is required");
  }
  return value;
}

export function validateReleaseTag(value) {
  if (!/^v\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/u.test(value ?? "")) {
    throw new Error("a semantic release tag is required");
  }
  return value;
}

export function verifyRemoteTag(repository, releaseTag, sourceSha, api = githubApi) {
  releaseRepository(repository);
  validateReleaseTag(releaseTag);
  if (!/^[0-9a-f]{40}$/u.test(sourceSha ?? ""))
    throw new Error("a full release source SHA is required");
  const ref = api(`repos/${repository}/git/ref/tags/${encodeURIComponent(releaseTag)}`);
  if (ref.ref !== `refs/tags/${releaseTag}`)
    throw new Error("remote release tag identity mismatch");
  let object = ref.object;
  for (let depth = 0; depth < 8; depth++) {
    if (!/^[0-9a-f]{40}$/u.test(object?.sha ?? "")) throw new Error("invalid remote tag object");
    if (object.type === "commit") {
      if (object.sha !== sourceSha)
        throw new Error("remote release tag changed from the verified source SHA");
      return;
    }
    if (object.type !== "tag") throw new Error("release tag must resolve to a commit");
    object = api(`repos/${repository}/git/tags/${object.sha}`).object;
  }
  throw new Error("release tag indirection limit exceeded");
}

export function parseArguments(argv, allowed) {
  const options = {};
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match || !allowed.includes(match[1]) || Object.hasOwn(options, match[1])) {
      throw new Error(`invalid or duplicate argument: ${argument}`);
    }
    options[match[1]] = match[2];
  }
  return options;
}

export async function describeAssets(directory) {
  const { files } = collectReleaseAssets(directory);
  return Promise.all(
    files.map(async ({ name }) => ({
      name,
      size: lstatSync(path.join(directory, name)).size,
      sha256: await sha256File(path.join(directory, name)),
    })),
  );
}

export function requireDraft(release, tag) {
  if (release.tag_name !== tag || release.draft !== true)
    throw new Error("Release must remain a draft with the expected tag");
}

export function releaseSnapshot(release) {
  return {
    id: release.id,
    tag: release.tag_name,
    body: release.body ?? "",
    assets: release.assets
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        size: asset.size,
        updated: asset.updated_at,
        digest: asset.digest ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
}

export function verifyUnchangedRelease(
  before,
  after,
  { allowAdded = false, ignoreChecksum = false } = {},
) {
  requireDraft(after, before.tag);
  const current = releaseSnapshot(after);
  if (before.id !== current.id || before.body !== current.body)
    throw new Error("Release identity or notes changed during verification");
  const oldAssets = before.assets.filter((asset) => !ignoreChecksum || asset.name !== "SHA256SUMS");
  const newAssets = current.assets.filter(
    (asset) => !ignoreChecksum || asset.name !== "SHA256SUMS",
  );
  if (!allowAdded && oldAssets.length !== newAssets.length)
    throw new Error("Release asset set changed during verification");
  for (const asset of oldAssets) {
    const matches = newAssets.filter((entry) => entry.name === asset.name);
    if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(asset)) {
      throw new Error(`Release asset changed during verification: ${asset.name}`);
    }
  }
}
