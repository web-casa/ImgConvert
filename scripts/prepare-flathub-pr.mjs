// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flatpakDir = path.join(repoRoot, "packaging", "flatpak");
const heicDir = path.join(flatpakDir, "extensions", "heic");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const version = packageJson.version;
const archiveName = `imgconvert-${version}-source.tar.gz`;

const options = {
  kind: "all",
  output: path.join(repoRoot, "target", "flathub"),
  sourceUrl:
    process.env.FLATHUB_SOURCE_URL ??
    `https://github.com/web-casa/ImgConvert/releases/download/v${version}/${archiveName}`,
  releaseRef: process.env.FLATHUB_RELEASE_REF ?? `v${version}`,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--kind=")) {
    const value = arg.slice("--kind=".length);
    if (!["main", "heic", "all"].includes(value)) {
      fail("--kind must be main, heic, or all");
    }
    options.kind = value;
  } else if (arg.startsWith("--output=")) {
    options.output = path.resolve(repoRoot, arg.slice("--output=".length));
  } else if (arg.startsWith("--source-url=")) {
    options.sourceUrl = arg.slice("--source-url=".length).trim();
  } else if (arg.startsWith("--release-ref=")) {
    options.releaseRef = arg.slice("--release-ref=".length).trim();
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

validateHttpsUrl(options.sourceUrl, `/${archiveName}`);
if (!options.releaseRef || /\s/.test(options.releaseRef)) {
  fail("--release-ref must be a tag or commit without whitespace");
}

run("node", ["scripts/check-flatpak-manifest.mjs"]);
run("node", ["scripts/check-flatpak-heic-extension.mjs"]);
run("node", ["scripts/check-flathub-metadata.mjs", "--no-appstreamcli"]);

if (options.kind === "main" || options.kind === "all") {
  prepareMainSubmission();
}
if (options.kind === "heic" || options.kind === "all") {
  prepareHeicSubmission();
}

console.log(`Flathub PR workspace prepared: ${path.relative(repoRoot, options.output)}`);

function prepareMainSubmission() {
  const outDir = path.join(options.output, "main");
  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });

  const manifestPath = path.join(flatpakDir, "io.github.yeagoo.imgconvert.yml");
  const manifest = readFileSync(manifestPath, "utf8")
    .replace(/(type:\s+archive\s*\n\s+)(?:path|url):\s+\S+/, `$1url: ${options.sourceUrl}`)
    .replace(
      /https:\/\/raw\.githubusercontent\.com\/web-casa\/ImgConvert\/[^/]+\/packaging\/flatpak\/screenshots\//g,
      rawGithubBase("packaging/flatpak/screenshots/"),
    );

  writeFileSync(path.join(outDir, "io.github.yeagoo.imgconvert.yml"), manifest);
  writeFileSync(
    path.join(outDir, "README.md"),
    [
      "# Flathub main package PR workspace",
      "",
      "Copy `io.github.yeagoo.imgconvert.yml` to a branch based on `flathub/flathub:new-pr`.",
      "",
      "Required local checks before opening the PR:",
      "",
      "```bash",
      "flatpak install -y flathub org.flatpak.Builder",
      "flatpak run --command=flathub-build org.flatpak.Builder --install io.github.yeagoo.imgconvert.yml",
      "flatpak run io.github.yeagoo.imgconvert",
      "flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest io.github.yeagoo.imgconvert.yml",
      "flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo",
      "```",
      "",
      `Source archive URL: ${options.sourceUrl}`,
      `Metadata release ref: ${options.releaseRef}`,
      "",
    ].join("\n"),
  );
}

function prepareHeicSubmission() {
  const outDir = path.join(options.output, "heic-extension");
  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });

  const sourceFiles = [
    "imgconvert-heic-helper.sh",
    "imgconvert-codec-heic.json",
    "io.github.yeagoo.imgconvert.Codecs.Heic.metainfo.xml",
    "LGPL_NOTICE.md",
  ];
  for (const file of sourceFiles) {
    copyFileSync(path.join(heicDir, file), path.join(outDir, file));
  }

  const manifest = rewriteHeicFileSources(
    readFileSync(path.join(heicDir, "io.github.yeagoo.imgconvert.Codecs.Heic.yml"), "utf8"),
    sourceFiles,
  );
  writeFileSync(path.join(outDir, "io.github.yeagoo.imgconvert.Codecs.Heic.yml"), manifest);
  writeFileSync(
    path.join(outDir, "README.md"),
    [
      "# Flathub HEIC extension PR workspace",
      "",
      "This is a separate LGPL decode-only addon review surface. Do not merge it",
      "into the Apache-2.0 main application manifest.",
      "",
      "Required local checks before opening the PR:",
      "",
      "```bash",
      "flatpak install -y flathub org.flatpak.Builder",
      "flatpak run --command=flathub-build org.flatpak.Builder io.github.yeagoo.imgconvert.Codecs.Heic.yml",
      "flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest io.github.yeagoo.imgconvert.Codecs.Heic.yml",
      "flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo",
      "```",
      "",
      "Run the real sandbox smoke from the ImgConvert repo after both the main",
      "package and extension are available from the same local Flatpak repo:",
      "",
      "```bash",
      "pnpm run release:flatpak:heic:real-smoke",
      "```",
      "",
      `Source file ref: ${options.releaseRef}`,
      "",
    ].join("\n"),
  );
}

function rewriteHeicFileSources(manifest, sourceFiles) {
  let updated = manifest;
  for (const file of sourceFiles) {
    const sourcePath = path.join(heicDir, file);
    const sha = sha256File(sourcePath);
    const url = `${rawGithubBase("packaging/flatpak/extensions/heic/")}${file}`;
    const sourcePattern = new RegExp(
      `(type:\\s+file\\s*\\n\\s+)path:\\s+${escapeRegExp(file)}`,
      "g",
    );
    updated = updated.replace(sourcePattern, `$1url: ${url}\n        sha256: ${sha}`);
  }
  return updated;
}

function rawGithubBase(relativeDir) {
  return `https://raw.githubusercontent.com/web-casa/ImgConvert/${options.releaseRef}/${relativeDir}`;
}

function sha256File(file) {
  const hash = createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
}

function validateHttpsUrl(value, expectedSuffix) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`invalid URL: ${value}`);
  }
  if (url.protocol !== "https:") {
    fail(`URL must use https: ${value}`);
  }
  if (!url.pathname.endsWith(expectedSuffix)) {
    fail(`URL must end with ${expectedSuffix}: ${value}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  console.error(`prepare-flathub-pr: ${message}`);
  process.exit(1);
}
