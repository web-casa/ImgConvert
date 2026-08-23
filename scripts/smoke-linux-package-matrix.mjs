// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  profile: "release",
  target: "",
  timeoutSeconds: 15,
  convertSmoke: true,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--profile=")) {
    options.profile = arg.slice("--profile=".length);
  } else if (arg.startsWith("--target=")) {
    options.target = arg.slice("--target=".length);
  } else if (arg.startsWith("--timeout=")) {
    options.timeoutSeconds = Number.parseInt(arg.slice("--timeout=".length), 10);
  } else if (arg === "--skip-convert-smoke") {
    options.convertSmoke = false;
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!["debug", "release"].includes(options.profile)) {
  fail(`unsupported profile: ${options.profile}`);
}
if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds < 3) {
  fail(`unsupported timeout: ${options.timeoutSeconds}`);
}

const matrix = [
  { bundle: "deb", image: "ubuntu:24.04" },
  { bundle: "deb", image: "debian:13" },
  { bundle: "rpm", image: "fedora:42" },
  { bundle: "appimage", image: "ubuntu:22.04" },
];

for (const item of matrix) {
  const args = [
    "scripts/smoke-linux-package-install.mjs",
    `--profile=${options.profile}`,
    `--bundle=${item.bundle}`,
    `--image=${item.image}`,
    `--timeout=${options.timeoutSeconds}`,
  ];
  if (options.target) {
    args.push(`--target=${options.target}`);
  }
  if (options.convertSmoke) {
    args.push("--convert-smoke");
  }
  console.log(`smoke ${item.bundle} in ${item.image}`);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`${item.bundle} smoke failed in ${item.image}`);
  }
}

console.log(`Linux package Docker smoke matrix passed (${matrix.length} run(s)).`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
