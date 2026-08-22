// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(repoRoot, "target", "aur", "imgconvert-bin");
const failures = [];
let dockerValidation = false;

for (const arg of process.argv.slice(2)) {
  if (arg === "--" || arg === "--docker") {
    dockerValidation ||= arg === "--docker";
    continue;
  }
  fail(`unknown argument: ${arg}`);
}

for (const name of ["PKGBUILD", ".SRCINFO", "imgconvert", "LICENSE"]) {
  const file = path.join(packageDir, name);
  if (!existsSync(file) || statSync(file).size === 0) {
    failures.push(`missing or empty generated AUR file: ${name}`);
  }
}

if (existsSync(packageDir)) {
  for (const entry of readdirSync(packageDir)) {
    if (entry.endsWith(".AppImage")) {
      failures.push(`AUR repository must not contain binary artifact: ${entry}`);
    }
  }
}

if (failures.length === 0) {
  const pkgbuild = readFileSync(path.join(packageDir, "PKGBUILD"), "utf8");
  const srcinfo = readFileSync(path.join(packageDir, ".SRCINFO"), "utf8");
  for (const denied of ["@VERSION@", "@APPIMAGE_SHA256@", "SKIP"]) {
    if (pkgbuild.includes(denied)) {
      failures.push(`generated PKGBUILD contains denied marker: ${denied}`);
    }
  }
  if (!srcinfo.includes("pkgbase = imgconvert-bin")) {
    failures.push("generated .SRCINFO has the wrong pkgbase");
  }

  const syntax = spawnSync("bash", ["-n", path.join(packageDir, "PKGBUILD")], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (syntax.status !== 0) {
    failures.push(`PKGBUILD shell syntax failed: ${syntax.stderr.trim()}`);
  }

  if (dockerValidation) {
    validateWithArchMakepkg(srcinfo);
  }
}

if (failures.length > 0) {
  console.error("AUR package check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`AUR package check passed: ${path.relative(repoRoot, packageDir)}`);

function validateWithArchMakepkg(expected) {
  const docker = resolveDockerCommand();
  const script = [
    "set -e",
    "useradd --create-home builder",
    "cp -a /input /home/builder/pkg",
    "chown -R builder:builder /home/builder/pkg",
    'runuser -u builder -- bash -lc "cd /home/builder/pkg && makepkg --printsrcinfo"',
  ].join("\n");
  const result = spawnSync(
    docker.command,
    [
      ...docker.prefixArgs,
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--volume",
      `${packageDir}:/input:ro`,
      "archlinux:base-devel",
      "bash",
      "-lc",
      script,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    failures.push(`Arch makepkg validation failed: ${result.stderr.trim()}`);
    return;
  }
  if (normalize(result.stdout) !== normalize(expected)) {
    failures.push("generated .SRCINFO differs from makepkg --printsrcinfo");
  }
}

function resolveDockerCommand() {
  if (commandSucceeds("docker", ["info"])) {
    return { command: "docker", prefixArgs: [] };
  }
  if (commandSucceeds("sudo", ["-n", "docker", "info"])) {
    return { command: "sudo", prefixArgs: ["-n", "docker"] };
  }
  fail("Docker is required for --docker AUR validation");
}

function commandSucceeds(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function normalize(value) {
  return `${value.trimEnd()}\n`;
}

function fail(message) {
  console.error(`verify-aur-package: ${message}`);
  process.exit(1);
}
