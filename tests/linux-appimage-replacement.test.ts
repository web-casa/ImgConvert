// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { expect, it } from "vitest";

it("refuses AppImage replacement on the host or for package-manager bundles", () => {
  for (const args of [["--bundle=appimage"], ["--bundle=deb", "--image=unused"]]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/smoke-linux-package-install.mjs", ...args, "--replace-from=/missing"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--replace-from requires");
  }
});

it("runs both images, rejects identical bytes and catches changed user files", () => {
  const source = readFileSync("scripts/smoke-linux-package-install.mjs", "utf8");
  for (const mode of ["success", "damage", "identical", "failure"]) {
    const root = mkdtempSync(path.join(tmpdir(), "imgconvert-replacement-test-"));
    const put = (name: string, body: string) =>
      writeFileSync(path.join(root, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    try {
      put("apt-get", "exit 0");
      put("xauth", "exit 0");
      put("xvfb-run", 'shift; exec "$@"');
      const body = (version: string) => `
        # ${version}
        [ "\${IMGCONVERT_PACKAGE_CONVERT_SMOKE:-}" = 1 ] || exit 0
        echo ${version} >> "$TEST_MARKER"
        if [ "${version}" = new ] && [ "$TEST_MODE" = failure ]; then exit 7; fi
        mkdir -p "$IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR"
        echo image > "$IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR/smoke.png"
        if [ "${version}" = new ] && [ "$TEST_MODE" = damage ]; then echo damaged > "${root}/imgconvert-replacement/pictures/original.png"; fi
        echo 'imgconvert package conversion smoke passed: jpeg,webp,png,avif'`;
      put("imgconvert-previous.AppImage", body("old"));
      put("candidate.AppImage", body(mode === "identical" ? "old" : "new"));
      const context = vm.createContext({
        options: {
          bundle: "appimage",
          replaceFrom: "previous",
          convertSmoke: true,
          timeoutSeconds: 3,
        },
        process: { env: {} },
      });
      vm.runInContext(source.slice(source.indexOf("function dockerSmokeScript(")), context);
      const script: string = vm.runInContext(
        'dockerSmokeScript("/tmp/candidate.AppImage")',
        context,
      );
      const result = spawnSync("sh", ["-c", script.replaceAll("/tmp/", `${root}/`)], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          TEST_MODE: mode,
          TEST_MARKER: path.join(root, "ran"),
        },
      });
      expect(result.status, result.stderr).toBe(
        mode === "success" ? 0 : mode === "failure" ? 7 : 1,
      );
      if (mode !== "identical")
        expect(readFileSync(path.join(root, "ran"), "utf8")).toBe("old\nnew\n");
      expect(result.stdout.includes("AppImage replacement passed")).toBe(mode === "success");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
