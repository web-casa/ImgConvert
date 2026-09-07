// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("release and PR workflow gates", () => {
  it.each(["x64", "arm64"])(
    "validates actual bilingual %s installer bundles through the upstream CLI",
    (arch) => {
      const root = mkdtempSync(path.join(tmpdir(), "imgconvert-windows-gate-"));
      try {
        mkdirSync(path.join(root, "msi"));
        mkdirSync(path.join(root, "nsis"));
        const windowsConfig = JSON.parse(readFileSync("src-tauri/tauri.windows.conf.json", "utf8"));
        expect(windowsConfig.bundle.windows.wix.language).toEqual(["en-US", "zh-CN"]);
        for (const language of ["en-US", "zh-CN"])
          writeFileSync(
            path.join(root, "msi", `ImgConvert_1.2.3_${arch}_${language}.msi`),
            "installer",
          );
        writeFileSync(path.join(root, "nsis", `ImgConvert_1.2.3_${arch}-setup.exe`), "installer");
        const check = () =>
          spawnSync(
            process.execPath,
            [
              "scripts/windows-release-assets.mjs",
              `--bundle-root=${root}`,
              "--release-tag=v1.2.3",
              `--architecture=${arch}`,
            ],
            { encoding: "utf8" },
          );
        expect(check().status).toBe(0);
        rmSync(path.join(root, "msi", `ImgConvert_1.2.3_${arch}_zh-CN.msi`));
        expect(check().status).not.toBe(0);
        // Three files alone are insufficient: a wrong language must still fail.
        writeFileSync(path.join(root, "msi", `ImgConvert_1.2.3_${arch}_fr-FR.msi`), "installer");
        expect(check().status).not.toBe(0);
        const workflow = parse(readFileSync(".github/workflows/windows-smoke.yml", "utf8"));
        const steps = Object.values(workflow.jobs).flatMap(
          (job) => (job as { steps: Array<{ name?: string; run?: string }> }).steps,
        );
        const unsigned = steps.find(
          (step) => step.name === "Verify release installers are intentionally unsigned",
        )!.run!;
        expect(unsigned).toContain("scripts/windows-release-assets.mjs");
        expect(unsigned).toContain("--bundle-root=");
        expect(unsigned).toContain("--architecture=");
        expect(unsigned).toContain("if ($LASTEXITCODE -ne 0)");
        expect(unsigned).not.toMatch(/\$installers\.Count -ne \d/u);
        expect(unsigned.indexOf("scripts/windows-release-assets.mjs")).toBeLessThan(
          unsigned.indexOf("Get-AuthenticodeSignature"),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["linux", "windows", "macos-notarization", "browser-extension"])(
    "records independent %s evidence before append-only finalization",
    (platform) => {
      const file =
        platform === "macos-notarization"
          ? "macos-notarization-finalize.yml"
          : `${platform}-release-assets-finalize.yml`;
      const workflow = parse(readFileSync(`.github/workflows/${file}`, "utf8"));
      const steps = (workflow.jobs.finalize ?? workflow.jobs.publish).steps as Array<{
        name?: string;
        run?: string;
        uses?: string;
        if?: string;
        with?: Record<string, unknown>;
      }>;
      const record = steps.findIndex((step) =>
        step.run?.includes("scripts/github-release-evidence.mjs"),
      );
      const upload = steps.findIndex(
        (step) =>
          step.uses?.startsWith("actions/upload-artifact@") &&
          String(step.with?.name).startsWith("imgconvert-release-evidence-"),
      );
      const append = steps.findIndex((step) =>
        step.run?.includes("scripts/append-github-release-assets.mjs"),
      );
      expect(record).toBeGreaterThan(0);
      expect(upload).toBeGreaterThan(record);
      expect(append).toBeGreaterThan(upload);
      expect(steps[upload].with?.["retention-days"]).toBe(90);
      expect(steps[append].if ?? "").not.toContain("always()");
      expect(steps.some((step) => step.run?.includes("gh release upload"))).toBe(false);
      if (platform === "macos-notarization") {
        const smoke = steps.findIndex((step) => step.run?.includes("--install-smoke"));
        expect(smoke).toBeGreaterThan(0);
        expect(smoke).toBeLessThan(record);
        expect(steps[record].if).toContain("notarization_status == 'Accepted'");
      }
    },
  );

  it("keeps evidence verification and a final remote snapshot check in the only publisher", () => {
    const workflow = parse(readFileSync(".github/workflows/github-release-publish.yml", "utf8"));
    expect(workflow.permissions.actions).toBe("read");
    const steps = workflow.jobs.publish.steps as Array<{ name?: string; run?: string }>;
    const verify = steps.find(
      (step) => step.name === "Download and verify complete candidate",
    )!.run!;
    expect(verify).toContain("scripts/verify-github-release-publication.mjs");
    expect(verify).toContain("--source-sha=");
    const publish = steps.find((step) => step.name === "Publish verified complete Release")!.run!;
    expect(publish.indexOf("--check-snapshot=")).toBeLessThan(publish.indexOf("gh release edit"));
  });

  it
    .skipIf(process.platform !== "linux")
    .each(["success", "error", "timeout", "no-marker", "no-output"])(
    "Snap finite conversion smoke handles %s",
    (mode) => {
      const root = mkdtempSync(path.join(tmpdir(), "imgconvert-snap-gate-"));
      try {
        const workflow = parse(readFileSync(".github/workflows/snap-store-release.yml", "utf8"));
        const script = workflow.jobs.snap.steps.find(
          (step: { name?: string }) => step.name === "Install and smoke built snap",
        ).run as string;
        // Execute the workflow with local command adapters and real timeout/pipefail.
        for (const [name, body] of Object.entries({
          sudo: 'exec "$@"',
          "xvfb-run": 'shift; exec "$@"',
          snap: `
if [ "$1" != run ]; then exit 0; fi
case "$REVIEW_MODE" in
  error) exit 70 ;;
  timeout) sleep 1; exit 0 ;;
esac
for ext in jpg webp png avif; do
  if [ "$REVIEW_MODE" != no-output ]; then echo fixture > "$IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR/smoke.$ext"; fi
done
if [ "$REVIEW_MODE" != no-marker ]; then echo 'imgconvert package conversion smoke passed: jpeg,webp,png,avif'; fi
exit 0`,
        })) {
          writeFileSync(path.join(root, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
        }
        const result = spawnSync(
          "bash",
          [
            "-c",
            script
              .replace(
                'smoke_dir="$HOME/snap/imgconvert/common/release-smoke"',
                'smoke_dir="$REVIEW_SMOKE_DIR"',
              )
              .replace("timeout 20s", "timeout 0.1s"),
          ],
          {
            cwd: root,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              IMGCONVERT_SNAP: "fixture.snap",
              REVIEW_MODE: mode,
              REVIEW_SMOKE_DIR: path.join(root, "results"),
            },
            timeout: 5_000,
          },
        );
        expect(result.error).toBeUndefined();
        if (mode === "success") expect(result.status, result.stderr).toBe(0);
        else expect(result.status).not.toBe(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("runs extension checks in the ordinary frontend PR job", () => {
    const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    expect(ci.on).toHaveProperty("pull_request");
    expect(ci.jobs.frontend.if).toBeUndefined();
    expect(
      ci.jobs.frontend.steps.some(
        (step: { run?: string }) => step.run === "pnpm run quality:frontend",
      ),
    ).toBe(true);
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts["quality:frontend"].split(" && ")).toContain("pnpm run extension:check");
    expect(scripts["extension:check"]).toBe("pnpm --dir browser-extension check");
    const extension = JSON.parse(readFileSync("browser-extension/package.json", "utf8")).scripts
      .check;
    for (const command of [
      "typecheck:only",
      "test",
      "build:chrome:only",
      "build:edge:only",
      "guardrails",
    ]) {
      expect(extension.split(" && ")).toContain(`pnpm run ${command}`);
    }
  });

  it("binds publisher extension verification to the target tag package", () => {
    const workflow = parse(readFileSync(".github/workflows/github-release-publish.yml", "utf8"));
    const run = workflow.jobs.publish.steps.find(
      (step: { name?: string }) => step.name === "Download and verify complete candidate",
    ).run;
    expect(run).toContain('git show "$RELEASE_TAG:browser-extension/package.json"');
    expect(run).toContain('--extension-version="$extension_version"');
    const finalizer = readFileSync(".github/workflows/windows-release-assets-finalize.yml", "utf8");
    expect(finalizer).toContain(
      'node scripts/windows-release-assets.mjs --assets-dir="$staged_dir" --release-tag="$RELEASE_TAG"',
    );
  });
});
