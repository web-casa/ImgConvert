// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { requiresForbiddenLicense } from "./license-policy.mjs";

const output = execFileSync("pnpm", ["licenses", "list", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const licenses = JSON.parse(output);
const violations = [];

for (const [license, packages] of Object.entries(licenses)) {
  if (!requiresForbiddenLicense(license)) continue;
  for (const pkg of packages) {
    violations.push(`${pkg.name}@${pkg.versions.join(", ")}: ${license}`);
  }
}

if (violations.length > 0) {
  console.error("Forbidden npm licenses detected:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("npm license check passed: every package has a non-GPL/AGPL/LGPL license path.");
