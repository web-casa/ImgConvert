// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { expect, it } from "vitest";

it("executes conversion after Docker launch and rejects failures or missing evidence", () => {
  const source = readFileSync("scripts/smoke-linux-package-install.mjs", "utf8");
  const context = vm.createContext({
    options: { bundle: "deb", convertSmoke: true, timeoutSeconds: 3 },
    process: { env: {} },
  });
  // Evaluate the production builders, then execute their full script in a real shell.
  vm.runInContext(source.slice(source.indexOf("function dockerSmokeScript(")), context);
  const script = vm.runInContext('dockerSmokeScript("/tmp/fixture.deb")', context);
  const root = mkdtempSync(path.join(tmpdir(), "imgconvert-package-shell-"));
  const put = (name: string, body: string) =>
    writeFileSync(path.join(root, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  try {
    put("apt-get", "exit 0");
    put("xauth", "exit 0");
    put("xvfb-run", 'shift; exec "$@"');
    put(
      "imgconvert",
      `
      [ -n "$IMGCONVERT_PACKAGE_CONVERT_SMOKE" ] || exit 0
      echo conversion-ran > "$TEST_MARKER"
      case "$TEST_MODE" in
        success) echo 'imgconvert package conversion smoke passed: jpeg,webp,png,avif';;
        failure) exit 7;;
        missing) exit 0;;
        timeout) sleep 10;;
      esac
    `,
    );
    for (const [mode, expected] of [
      ["success", 0],
      ["failure", 7],
      ["missing", 1],
      ["timeout", 124],
    ] as const) {
      const marker = path.join(root, mode);
      const result = spawnSync("sh", ["-c", script], {
        encoding: "utf8",
        timeout: 8000,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          TEST_MODE: mode,
          TEST_MARKER: marker,
        },
      });
      expect(result.status, `${mode}: ${result.stderr}`).toBe(expected);
      expect(readFileSync(marker, "utf8")).toContain("conversion-ran");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
