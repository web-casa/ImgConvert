import { createFixture } from "./helpers/github-release-fixture";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- Production release tools are plain ESM for dependency-free runners.
const toolModule1 = await import("../scripts/github-release-assets.mjs");
const { githubReleaseAssetGroups, releaseEvidenceName, releaseEvidenceWorkflows } = toolModule1;
// @ts-expect-error -- Production release tools are plain ESM for dependency-free runners.
const toolModule2 = await import("../scripts/github-release-evidence.mjs");
const { createReleaseEvidence, evidenceArtifactName, verifyReleaseEvidence } = toolModule2;
// @ts-expect-error -- Production release tools are plain ESM for dependency-free runners.
const toolModule3 = await import("../scripts/verify-github-release-publication.mjs");
const { verifyPublication } = toolModule3;
// @ts-expect-error -- Production release tools are plain ESM for dependency-free runners.
const toolModule4 = await import("../scripts/refresh-github-release-checksums.mjs");
const { refreshGithubReleaseChecksums } = toolModule4;

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "imgconvert-evidence-test-"));
  directories.push(root);
  const assetsDir = path.join(root, "assets");
  mkdirSync(assetsDir);
  const options = {
    assetsDir,
    releaseTag: "v1.2.3",
    sourceSha: "a".repeat(40),
    extensionVersion: "0.3.2",
    repository: "web-casa/ImgConvert",
  };
  const records: Array<{ group: string; raw: string; runId: number; workflowId: number }> = [];
  const candidate = createFixture();
  const groups = githubReleaseAssetGroups("1.2.3", "0.3.2") as Record<string, string[]>;
  for (const [group, names] of Object.entries(groups)) {
    const stage = path.join(root, group);
    mkdirSync(stage);
    for (const name of names) {
      copyFileSync(path.join(candidate.assetsDir, name), path.join(stage, name));
      copyFileSync(path.join(stage, name), path.join(assetsDir, name));
    }
    const runId = records.length + 101;
    const { evidence, name } = await createReleaseEvidence({
      ...options,
      group,
      assetsDir: stage,
      env: {
        GITHUB_RUN_ID: String(runId),
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_SHA: "b".repeat(40),
        GITHUB_REPOSITORY: options.repository,
      },
    });
    const raw = `${JSON.stringify(evidence, null, 2)}\n`;
    writeFileSync(path.join(assetsDir, name), raw);
    records.push({ group, raw, runId, workflowId: records.length + 1001 });
  }
  const api = (endpoint: string) => {
    if (endpoint === `repos/${options.repository}`) return { default_branch: "main" };
    const runId = Number(/\/runs\/(\d+)/u.exec(endpoint)?.[1]);
    const workflowId = Number(/\/workflows\/(\d+)/u.exec(endpoint)?.[1]);
    const record = records.find(
      (entry) => entry.runId === runId || entry.workflowId === workflowId,
    );
    if (!record) throw new Error(`unexpected API call: ${endpoint}`);
    const workflowPath = `.github/workflows/${releaseEvidenceWorkflows[record.group]}`;
    if (endpoint.includes("/artifacts?"))
      return {
        total_count: 1,
        artifacts: [
          {
            id: record.runId + 2000,
            name: evidenceArtifactName(record.group, 1),
            expired: false,
            workflow_run: { id: record.runId, head_sha: "b".repeat(40) },
          },
        ],
      };
    if (workflowId) return { id: record.workflowId, path: workflowPath };
    return {
      id: record.runId,
      run_attempt: 1,
      workflow_id: record.workflowId,
      path: workflowPath,
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: "b".repeat(40),
      repository: { full_name: options.repository },
      head_repository: { full_name: options.repository },
    };
  };
  const execute = (command: string, args: string[]) => {
    if (command === "git") {
      expect(args).toEqual(["merge-base", "--is-ancestor", "b".repeat(40), "origin/main"]);
      return "";
    }
    expect(command).toBe("gh");
    expect(args.slice(0, 2)).toEqual(["run", "download"]);
    const record = records.find((entry) => String(entry.runId) === args[2]);
    if (!record) throw new Error("unexpected artifact download");
    const directory = args[args.indexOf("--dir") + 1];
    writeFileSync(path.join(directory, releaseEvidenceName(record.group)), record.raw);
    return "";
  };
  return { options, api, execute, records };
}

describe("release evidence from trusted Actions runs", () => {
  it.each([false, true])(
    "runs the complete publication gate with real ZIP/checksum fixtures (tampered=%s)",
    async (tampered) => {
      const test = await fixture();
      if (tampered)
        writeFileSync(
          path.join(test.options.assetsDir, "ImgConvert_1.2.3_arm64.dmg"),
          "replacement",
        );
      await refreshGithubReleaseChecksums(test.options.assetsDir);
      const api = (endpoint: string) => {
        if (endpoint.includes("/git/ref/"))
          return {
            ref: "refs/tags/v1.2.3",
            object: { type: "commit", sha: test.options.sourceSha },
          };
        if (endpoint.includes("/releases/tags/"))
          return {
            id: 1,
            tag_name: "v1.2.3",
            draft: true,
            body: "Windows installers are unsigned and may trigger SmartScreen.",
            assets: readdirSync(test.options.assetsDir).map((name, index) => ({
              id: index + 1,
              name,
              size: statSync(path.join(test.options.assetsDir, name)).size,
              updated_at: "2026-09-05",
            })),
          };
        return test.api(endpoint);
      };
      const execute = (command: string, args: string[]) => {
        if (command === "gh" && args[0] === "release" && args[1] === "download") {
          const target = args[args.indexOf("--dir") + 1];
          for (const name of readdirSync(test.options.assetsDir))
            copyFileSync(path.join(test.options.assetsDir, name), path.join(target, name));
          return "";
        }
        return test.execute(command, args);
      };
      const root = path.dirname(test.options.assetsDir);
      const snapshotPath = path.join(root, "verified-snapshot.json");
      const result = verifyPublication({
        ...test.options,
        assetsDir: path.join(root, "downloaded"),
        snapshotPath,
        api,
        execute,
      });
      if (tampered) {
        await expect(result).rejects.toThrow(/final release bytes/);
        expect(existsSync(snapshotPath)).toBe(false);
      } else {
        await expect(result).resolves.toBeUndefined();
        const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
        expect(snapshot.assets).toHaveLength(27);
        expect(snapshot.sourceSha).toBe(test.options.sourceSha);
      }
    },
  );

  it("accepts all six independent evidence groups bound to final bytes", async () => {
    const test = await fixture();
    await expect(
      verifyReleaseEvidence({ ...test.options, api: test.api, execute: test.execute }),
    ).resolves.toBeUndefined();
  });

  it("rejects a replaced DMG even if the release checksum is regenerated", async () => {
    const test = await fixture();
    writeFileSync(
      path.join(test.options.assetsDir, "ImgConvert_1.2.3_arm64.dmg"),
      "replacement DMG",
    );
    await expect(
      verifyReleaseEvidence({ ...test.options, api: test.api, execute: test.execute }),
    ).rejects.toThrow(/final release bytes/);
  });

  it("rejects a forged Release receipt instead of trusting its refreshed digest", async () => {
    const test = await fixture();
    const receipt = path.join(test.options.assetsDir, "release-evidence-macos-arm64.json");
    const forged = JSON.parse(readFileSync(receipt, "utf8"));
    forged.assets[0].sha256 = "c".repeat(64);
    writeFileSync(receipt, `${JSON.stringify(forged, null, 2)}\n`);
    await expect(
      verifyReleaseEvidence({ ...test.options, api: test.api, execute: test.execute }),
    ).rejects.toThrow(/differs from Actions artifact/);
  });

  it.each([
    ["conclusion", "failure"],
    ["status", "in_progress"],
    ["event", "pull_request"],
    ["head_branch", "unreviewed"],
    ["head_sha", "c".repeat(40)],
    ["run_attempt", 2],
    ["path", ".github/workflows/untrusted.yml"],
    ["head_repository", { full_name: "attacker/fork" }],
  ])("rejects an untrusted run %s", async (field, value) => {
    const test = await fixture();
    const api = (endpoint: string) => {
      const response = test.api(endpoint);
      return /\/runs\/\d+$/u.test(endpoint) ? { ...response, [String(field)]: value } : response;
    };
    await expect(
      verifyReleaseEvidence({ ...test.options, api, execute: test.execute }),
    ).rejects.toThrow(/untrusted or unsuccessful/);
  });

  it.each(["expired", "missing", "duplicate"])("rejects %s evidence artifacts", async (mode) => {
    const test = await fixture();
    const api = (endpoint: string) => {
      const response = test.api(endpoint);
      if (!endpoint.includes("/artifacts?")) return response;
      const artifact = response.artifacts?.[0];
      const artifacts =
        mode === "missing"
          ? []
          : mode === "duplicate"
            ? [artifact, artifact]
            : [{ ...artifact, expired: true }];
      return { total_count: artifacts.length, artifacts };
    };
    await expect(
      verifyReleaseEvidence({ ...test.options, api, execute: test.execute }),
    ).rejects.toThrow(/missing, expired, or ambiguous/);
  });

  it("rejects evidence from another tag source commit", async () => {
    const test = await fixture();
    await expect(
      verifyReleaseEvidence({
        ...test.options,
        sourceSha: "c".repeat(40),
        api: test.api,
        execute: test.execute,
      }),
    ).rejects.toThrow(/identity mismatch/);
  });
});
