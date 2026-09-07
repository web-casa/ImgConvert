// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("desktop E2E fixture ownership", () => {
  it("reuses launcher fixtures and only lets their owner clean up", () => {
    const env = { ...process.env };
    delete env.IMGCONVERT_DESKTOP_E2E_SESSION_ROOT;
    const result = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { existsSync, readFileSync } from 'node:fs';
      import path from 'node:path';
      const launcher = await import('./e2e-desktop/wdio.conf.mjs?launcher');
      const root = process.env.IMGCONVERT_DESKTOP_E2E_SESSION_ROOT;
      try {
        const original = readFileSync(process.env.IMGCONVERT_DESKTOP_E2E_INPUT);
        const worker = await import('./e2e-desktop/wdio.conf.mjs?worker');
        const sameRoot = root === process.env.IMGCONVERT_DESKTOP_E2E_SESSION_ROOT;
        worker.config.onComplete();
        const preserved = existsSync(root) && original.equals(readFileSync(process.env.IMGCONVERT_DESKTOP_E2E_INPUT));
        const isolated = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'].every(key =>
          process.env[key].startsWith(root + path.sep));
        launcher.config.onComplete();
        console.log(JSON.stringify({ sameRoot, preserved, isolated, cleaned: !existsSync(root) }));
      } finally { launcher.config.onComplete(); }
    `,
      ],
      { env, encoding: "utf8" },
    );
    expect(JSON.parse(result)).toEqual({
      sameRoot: true,
      preserved: true,
      isolated: true,
      cleaned: true,
    });
  });
});
