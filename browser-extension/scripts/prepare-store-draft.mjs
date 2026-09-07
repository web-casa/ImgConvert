// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(projectRoot, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;

await run(pnpm, ["run", "store:assets:graphics"], projectRoot);
await run(pnpm, ["run", "runtime:build"], projectRoot);
await run(pnpm, ["run", "build:chrome:only"], projectRoot);
await run(pnpm, ["run", "build:edge:only"], projectRoot);
await run(pnpm, ["run", "guardrails"], projectRoot);
await run(pnpm, ["run", "zip"], projectRoot);
await run(pnpm, ["run", "guardrails"], projectRoot);

const screenshotArguments = [
  node,
  join(projectRoot, "scripts", "render-store-assets.mjs"),
  "--mode=screenshots",
];
if (process.platform === "linux" && !process.env.DISPLAY) {
  await access("/usr/bin/xvfb-run");
  await run("/usr/bin/xvfb-run", ["-a", ...screenshotArguments], projectRoot);
} else {
  await run(screenshotArguments[0], screenshotArguments.slice(1), projectRoot);
}

await run(pnpm, ["run", "license:npm"], repositoryRoot);
await run(pnpm, ["run", "license:verify"], repositoryRoot);
await run(node, [join(projectRoot, "scripts", "create-store-candidate.mjs")], projectRoot);
await run(pnpm, ["run", "store:check"], projectRoot);

console.log("EXT-008 local Chrome/Edge store draft preparation passed. No upload was performed.");

async function run(command, arguments_, cwd) {
  console.log(`\n> ${command} ${arguments_.join(" ")}`);
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(
            `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
          ),
        );
      }
    });
  });
}
