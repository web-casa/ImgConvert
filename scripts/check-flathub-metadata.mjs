// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const flatpakDir = path.join(repoRoot, "packaging", "flatpak");
const files = {
  mainManifest: path.join(flatpakDir, "io.github.yeagoo.imgconvert.yml"),
  mainMetainfo: path.join(flatpakDir, "io.github.yeagoo.imgconvert.metainfo.xml"),
  heicManifest: path.join(
    flatpakDir,
    "extensions",
    "heic",
    "io.github.yeagoo.imgconvert.Codecs.Heic.yml",
  ),
  heicMetainfo: path.join(
    flatpakDir,
    "extensions",
    "heic",
    "io.github.yeagoo.imgconvert.Codecs.Heic.metainfo.xml",
  ),
};

const options = {
  appstream: true,
  flathubLint: false,
  requireFlathubBuilder: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--no-appstreamcli") {
    options.appstream = false;
  } else if (arg === "--flathub-lint") {
    options.flathubLint = true;
  } else if (arg === "--require-flathub-builder") {
    options.flathubLint = true;
    options.requireFlathubBuilder = true;
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

const failures = [];

for (const file of Object.values(files)) {
  if (!existsSync(file)) {
    failures.push(`missing ${path.relative(repoRoot, file)}`);
  }
}

if (failures.length === 0) {
  inspectMainMetainfo(readFileSync(files.mainMetainfo, "utf8"));
  inspectHeicMetainfo(readFileSync(files.heicMetainfo, "utf8"));
  if (options.appstream) {
    runAppstreamValidation(files.mainMetainfo);
    runAppstreamValidation(files.heicMetainfo);
  }
  if (options.flathubLint) {
    runFlathubLint();
  }
}

if (failures.length > 0) {
  console.error("Flathub metadata check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Flathub metadata check passed.");

function inspectMainMetainfo(text) {
  for (const expected of [
    '<component type="desktop-application">',
    "<id>io.github.yeagoo.imgconvert</id>",
    "<metadata_license>CC0-1.0</metadata_license>",
    "<project_license>Apache-2.0</project_license>",
    '<developer id="io.github.yeagoo">',
    "<name>ImgConvert contributors</name>",
    '<url type="homepage">https://github.com/web-casa/ImgConvert</url>',
    '<url type="vcs-browser">https://github.com/web-casa/ImgConvert</url>',
    '<url type="bugtracker">https://github.com/web-casa/ImgConvert/issues</url>',
    '<launchable type="desktop-id">io.github.yeagoo.imgconvert.desktop</launchable>',
    '<content_rating type="oars-1.1" />',
    "<screenshots>",
    '<screenshot type="default">',
    "<caption>Batch image conversion queue and output settings</caption>",
    `<release version="${packageJson.version}"`,
  ]) {
    requireText(text, expected, `main MetaInfo missing ${expected}`);
  }
  if (text.includes("<developer_name>")) {
    failures.push("main MetaInfo must use developer/name instead of deprecated developer_name");
  }
  inspectScreenshots(text);
  for (const forbidden of ["HEIC helper plugins are bundled", "libheif", "x265"]) {
    if (text.includes(forbidden)) {
      failures.push(`main MetaInfo must not imply bundled HEIC codec support: ${forbidden}`);
    }
  }
}

function inspectHeicMetainfo(text) {
  for (const expected of [
    '<component type="addon">',
    "<id>io.github.yeagoo.imgconvert.Codecs.Heic</id>",
    "<extends>io.github.yeagoo.imgconvert</extends>",
    "<metadata_license>CC0-1.0</metadata_license>",
    "<project_license>LGPL-3.0-or-later</project_license>",
    '<developer id="io.github.yeagoo">',
    "<name>ImgConvert contributors</name>",
    '<url type="homepage">https://github.com/web-casa/ImgConvert</url>',
    '<url type="vcs-browser">https://github.com/web-casa/ImgConvert</url>',
    "decode-only",
    "does not provide HEIC",
  ]) {
    requireText(text, expected, `HEIC extension MetaInfo missing ${expected}`);
  }
}

function inspectScreenshots(text) {
  const imageMatches = [...text.matchAll(/<image>(https:\/\/[^<]+)<\/image>/g)].map(
    (match) => match[1],
  );
  if (imageMatches.length === 0) {
    failures.push("main MetaInfo must include at least one HTTPS screenshot image");
  }
  for (const url of imageMatches) {
    if (!/\.(png|jpg|jpeg|webp)$/i.test(new URL(url).pathname)) {
      failures.push(`screenshot URL must point at an image file: ${url}`);
    }
    if (/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(main|master)\//.test(url)) {
      failures.push(
        `screenshot URL must be rewritten to a release tag or commit before Flathub PR: ${url}`,
      );
    }
    const localPath = localScreenshotPath(url);
    if (localPath && !existsSync(localPath)) {
      failures.push(`screenshot URL has no matching local file: ${url}`);
    }
  }
}

function localScreenshotPath(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(
    /^\/yeagoo\/imgconvert\/[^/]+\/(packaging\/flatpak\/screenshots\/[^/]+)$/u,
  );
  if (!match) {
    return null;
  }
  return path.join(repoRoot, match[1]);
}

function runAppstreamValidation(file) {
  if (!commandExists("appstreamcli")) {
    console.warn("appstreamcli not found; skipping AppStream validation.");
    return;
  }
  const result = spawnSync("appstreamcli", ["validate", "--no-net", file], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    failures.push(`appstreamcli validate failed for ${path.relative(repoRoot, file)}`);
  }
}

function runFlathubLint() {
  if (!flathubBuilderInstalled()) {
    const message = "org.flatpak.Builder is not installed; install it to run Flathub builder lint.";
    if (options.requireFlathubBuilder) {
      failures.push(message);
    } else {
      console.warn(`${message} Skipping optional linter.`);
    }
    return;
  }

  runFlatpakBuilderLint("appstream", files.mainMetainfo);
  runFlatpakBuilderLint("appstream", files.heicMetainfo);
  runFlatpakBuilderLint("manifest", files.mainManifest);
  runFlatpakBuilderLint("manifest", files.heicManifest);
}

function runFlatpakBuilderLint(kind, file) {
  const result = spawnSync(
    "flatpak",
    ["run", "--command=flatpak-builder-lint", "org.flatpak.Builder", kind, file],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    failures.push(`flatpak-builder-lint ${kind} failed for ${path.relative(repoRoot, file)}`);
  }
}

function flathubBuilderInstalled() {
  const result = spawnSync("flatpak", ["info", "org.flatpak.Builder"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  return result.status === 0;
}

function commandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) {
    failures.push(message);
  }
}

function fail(message) {
  console.error(`check-flathub-metadata: ${message}`);
  process.exit(1);
}
