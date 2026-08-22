// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = readJson(path.join(repoRoot, "package.json"));
const aurSource = path.join(repoRoot, "packaging", "aur");
const options = {
  artifact: "",
  output: path.join(repoRoot, "target", "aur", "imgconvert-bin"),
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--artifact=")) {
    options.artifact = path.resolve(repoRoot, arg.slice("--artifact=".length));
  } else if (arg.startsWith("--output=")) {
    options.output = path.resolve(repoRoot, arg.slice("--output=".length));
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

const expectedName = `ImgConvert-${packageJson.version}-x86_64.AppImage`;
const artifact = options.artifact || path.join(repoRoot, "target", "appimagehub", expectedName);
if (!existsSync(artifact) || statSync(artifact).size === 0) {
  fail(`canonical x86_64 AppImage is missing or empty: ${artifact}`);
}
if (path.basename(artifact) !== expectedName) {
  fail(`AUR source must use canonical name ${expectedName}, got ${path.basename(artifact)}`);
}

const wrapper = path.join(aurSource, "imgconvert");
const license = path.join(repoRoot, "LICENSE");
const hashes = {
  appImage: sha256(artifact),
  wrapper: sha256(wrapper),
  license: sha256(license),
};
const replacements = new Map([
  ["@VERSION@", packageJson.version],
  ["@APPIMAGE_SHA256@", hashes.appImage],
  ["@WRAPPER_SHA256@", hashes.wrapper],
  ["@LICENSE_SHA256@", hashes.license],
]);

let pkgbuild = readFileSync(path.join(aurSource, "PKGBUILD.template"), "utf8");
for (const [placeholder, value] of replacements) {
  if (pkgbuild.split(placeholder).length !== 2) {
    fail(`PKGBUILD template must contain ${placeholder} exactly once`);
  }
  pkgbuild = pkgbuild.replace(placeholder, value);
}
if (pkgbuild.includes("@") || /\bSKIP\b/.test(pkgbuild)) {
  fail("generated PKGBUILD contains a placeholder or SKIP checksum");
}

mkdirSync(options.output, { recursive: true });
writeFileSync(path.join(options.output, "PKGBUILD"), pkgbuild, "utf8");
copyFileSync(wrapper, path.join(options.output, "imgconvert"));
copyFileSync(license, path.join(options.output, "LICENSE"));
writeFileSync(path.join(options.output, ".SRCINFO"), srcinfo(packageJson.version, hashes), "utf8");

const syntax = spawnSync("bash", ["-n", path.join(options.output, "PKGBUILD")], {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (syntax.status !== 0) {
  fail(`generated PKGBUILD has invalid shell syntax: ${syntax.stderr.trim()}`);
}

console.log(`AUR package prepared: ${path.relative(repoRoot, options.output)}`);

function srcinfo(version, checksums) {
  return `pkgbase = imgconvert-bin
\tpkgdesc = Local-first batch image converter (prebuilt AppImage)
\tpkgver = ${version}
\tpkgrel = 1
\turl = https://github.com/web-casa/ImgConvert
\tarch = x86_64
\tlicense = Apache-2.0
\tdepends = bash
\tdepends = glibc
\tprovides = imgconvert=${version}
\tconflicts = imgconvert
\toptions = !strip
\tsource = imgconvert
\tsource = LICENSE
\tsha256sums = ${checksums.wrapper}
\tsha256sums = ${checksums.license}
\tsource_x86_64 = ImgConvert-${version}-x86_64.AppImage::https://github.com/web-casa/ImgConvert/releases/download/v${version}/ImgConvert-${version}-x86_64.AppImage
\tsha256sums_x86_64 = ${checksums.appImage}

pkgname = imgconvert-bin
`;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function fail(message) {
  console.error(`prepare-aur-package: ${message}`);
  process.exit(1);
}
