// SPDX-License-Identifier: Apache-2.0
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  githubReleaseAssetGroups,
  releaseEvidenceName,
  releaseEvidenceWorkflows,
} from "./github-release-assets.mjs";
import {
  describeAssets,
  githubApi,
  parseArguments,
  releaseRepository,
  run,
  validateReleaseTag,
} from "./github-release-client.mjs";

function requireSha(value) {
  if (!/^[0-9a-f]{40}$/u.test(value ?? ""))
    throw new Error("release evidence needs a full source/workflow SHA");
  return value;
}

export function evidenceArtifactName(group, attempt) {
  releaseEvidenceName(group);
  if (!/^[1-9][0-9]*$/u.test(String(attempt))) throw new Error("invalid evidence run attempt");
  return `imgconvert-release-evidence-${group}-${attempt}`;
}

export async function createReleaseEvidence({
  group,
  assetsDir,
  releaseTag,
  sourceSha,
  extensionVersion,
  env = process.env,
}) {
  validateReleaseTag(releaseTag);
  const name = releaseEvidenceName(group);
  const expected = githubReleaseAssetGroups(releaseTag.slice(1), extensionVersion)[group];
  const assets = await describeAssets(assetsDir);
  if (
    JSON.stringify(assets.map((asset) => asset.name).sort()) !==
    JSON.stringify([...expected].sort())
  ) {
    throw new Error(`release evidence must cover exactly the ${group} asset set`);
  }
  const runId = env.GITHUB_RUN_ID;
  if (!/^[1-9][0-9]*$/u.test(runId ?? ""))
    throw new Error("release evidence must be created in an Actions run");
  const attempt = env.GITHUB_RUN_ATTEMPT;
  evidenceArtifactName(group, attempt);
  const evidence = {
    schemaVersion: 1,
    group,
    releaseTag,
    sourceSha: requireSha(sourceSha),
    repository: releaseRepository(env.GITHUB_REPOSITORY),
    runId,
    runAttempt: Number(attempt),
    workflowSha: requireSha(env.GITHUB_SHA),
    assets,
  };
  return { name, evidence };
}

export function validateEvidenceRun(evidence, runInfo, workflow, defaultBranch) {
  const expectedPath = `.github/workflows/${releaseEvidenceWorkflows[evidence.group]}`;
  if (
    String(runInfo.id) !== evidence.runId ||
    runInfo.run_attempt !== evidence.runAttempt ||
    runInfo.status !== "completed" ||
    runInfo.conclusion !== "success" ||
    runInfo.event !== "workflow_dispatch" ||
    runInfo.head_branch !== defaultBranch ||
    runInfo.head_repository?.full_name !== evidence.repository ||
    runInfo.repository?.full_name !== evidence.repository ||
    runInfo.head_sha !== evidence.workflowSha ||
    workflow.path !== expectedPath ||
    runInfo.path !== expectedPath ||
    workflow.id !== runInfo.workflow_id
  )
    throw new Error(`untrusted or unsuccessful evidence workflow for ${evidence.group}`);
}

function readEvidence(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
    throw new Error("unsafe release evidence file");
  return readFileSync(file, "utf8");
}

// The Release copy is a locator, not a trust anchor. Only an exact copy downloaded
// from the successful, allowlisted Actions run can authorize its recorded bytes.
export async function verifyReleaseEvidence({
  assetsDir,
  releaseTag,
  sourceSha,
  extensionVersion,
  repository,
  api = githubApi,
  execute = run,
}) {
  repository = releaseRepository(repository);
  validateReleaseTag(releaseTag);
  requireSha(sourceSha);
  const groups = githubReleaseAssetGroups(releaseTag.slice(1), extensionVersion);
  const defaultBranch = api(`repos/${repository}`).default_branch;
  const actualAssets = await describeAssets(assetsDir);
  for (const [group, expectedNames] of Object.entries(groups)) {
    const name = releaseEvidenceName(group);
    const raw = readEvidence(path.join(assetsDir, name));
    const evidence = JSON.parse(raw);
    if (
      evidence.schemaVersion !== 1 ||
      evidence.group !== group ||
      evidence.releaseTag !== releaseTag ||
      evidence.sourceSha !== sourceSha ||
      evidence.repository !== repository ||
      !/^[1-9][0-9]*$/u.test(evidence.runId ?? "") ||
      !Array.isArray(evidence.assets)
    )
      throw new Error(`release evidence identity mismatch for ${group}`);
    requireSha(evidence.workflowSha);
    const artifactName = evidenceArtifactName(group, evidence.runAttempt);
    const runInfo = api(`repos/${repository}/actions/runs/${evidence.runId}`);
    if (!Number.isSafeInteger(runInfo.workflow_id) || runInfo.workflow_id <= 0)
      throw new Error("invalid evidence workflow ID");
    const workflow = api(`repos/${repository}/actions/workflows/${runInfo.workflow_id}`);
    validateEvidenceRun(evidence, runInfo, workflow, defaultBranch);
    // A named branch alone is insufficient if its commit is unrelated to main.
    execute("git", [
      "merge-base",
      "--is-ancestor",
      evidence.workflowSha,
      `origin/${defaultBranch}`,
    ]);
    const artifacts = [];
    for (let page = 1; ; page++) {
      const result = api(
        `repos/${repository}/actions/runs/${evidence.runId}/artifacts?per_page=100&page=${page}`,
      );
      artifacts.push(...result.artifacts);
      if (artifacts.length >= result.total_count) break;
      if (result.artifacts.length === 0 || page >= 100)
        throw new Error("incomplete evidence artifact listing");
    }
    const candidates = artifacts.filter((artifact) => artifact.name === artifactName);
    if (
      candidates.length !== 1 ||
      candidates[0].expired !== false ||
      candidates[0].workflow_run?.id !== runInfo.id ||
      candidates[0].workflow_run?.head_sha !== evidence.workflowSha
    ) {
      throw new Error(`missing, expired, or ambiguous Actions evidence: ${artifactName}`);
    }
    const directory = mkdtempSync(path.join(tmpdir(), "imgconvert-trusted-evidence-"));
    try {
      execute("gh", [
        "run",
        "download",
        evidence.runId,
        "--repo",
        repository,
        "--name",
        artifactName,
        "--dir",
        directory,
      ]);
      if (readdirSync(directory).length !== 1 || readEvidence(path.join(directory, name)) !== raw) {
        throw new Error(`Release evidence differs from Actions artifact: ${group}`);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    validateEvidenceRun(
      evidence,
      api(`repos/${repository}/actions/runs/${evidence.runId}`),
      workflow,
      defaultBranch,
    );
    const rows = expectedNames.map((assetName) =>
      actualAssets.find((asset) => asset.name === assetName),
    );
    if (
      rows.some((asset) => !asset) ||
      JSON.stringify([...evidence.assets].sort(byName)) !== JSON.stringify(rows.sort(byName))
    ) {
      throw new Error(`final release bytes do not match verified evidence: ${group}`);
    }
  }
}

function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2), [
      "group",
      "assets-dir",
      "release-tag",
      "source-sha",
      "extension-version",
      "output-dir",
    ]);
    const { name, evidence } = await createReleaseEvidence({
      group: args.group,
      assetsDir: args["assets-dir"],
      releaseTag: args["release-tag"],
      sourceSha: args["source-sha"],
      extensionVersion: args["extension-version"],
    });
    mkdirSync(args["output-dir"], { recursive: true });
    writeFileSync(path.join(args["output-dir"], name), `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: "wx",
    });
    console.log(`Recorded final release bytes: ${name}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
