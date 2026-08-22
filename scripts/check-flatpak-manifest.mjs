// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flatpakDir = path.join(repoRoot, "packaging", "flatpak");
const manifestPath = path.join(flatpakDir, "io.github.yeagoo.imgconvert.yml");
const desktopPath = path.join(flatpakDir, "io.github.yeagoo.imgconvert.desktop");
const metainfoPath = path.join(flatpakDir, "io.github.yeagoo.imgconvert.metainfo.xml");
const prepareScriptPath = path.join(repoRoot, "scripts", "prepare-flatpak-release.mjs");
const heicExtensionDir = path.join(flatpakDir, "extensions", "heic");

const failures = [];

for (const file of [manifestPath, desktopPath, metainfoPath, prepareScriptPath]) {
  if (!existsSync(file)) {
    failures.push(`missing ${path.relative(repoRoot, file)}`);
  }
}

if (failures.length === 0) {
  inspectManifest(readFileSync(manifestPath, "utf8"));
  inspectDesktop(readFileSync(desktopPath, "utf8"));
  inspectMetainfo(readFileSync(metainfoPath, "utf8"));
  inspectPrepareScript(readFileSync(prepareScriptPath, "utf8"));
  inspectHeicExtensionTemplate();
  inspectReadme();
}

if (failures.length > 0) {
  console.error("Flatpak manifest check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Flatpak manifest check passed.");

function inspectManifest(text) {
  requireText(
    text,
    "app-id: io.github.yeagoo.imgconvert",
    "manifest app-id must use the Flathub GitHub namespace",
  );
  requireText(text, "runtime: org.gnome.Platform", "manifest must use GNOME runtime");
  requireText(text, 'runtime-version: "50"', "manifest must track supported GNOME runtime 50");
  requireText(text, "sdk: org.gnome.Sdk", "manifest must use GNOME SDK");
  requireText(
    text,
    "--env=IMGCONVERT_DISABLE_EXTERNAL_CODECS=1",
    "Flatpak main package must disable external codec helpers",
  );
  requireText(
    text,
    "--env=IMGCONVERT_ALLOW_FLATPAK_CODEC_EXTENSIONS=1",
    "Flatpak main package must allow only mounted codec extensions",
  );
  for (const expected of [
    "add-extensions:",
    "io.github.yeagoo.imgconvert.Codecs:",
    'version: "1"',
    "directory: extensions/codecs",
    "add-ld-path: lib",
    "subdirectories: true",
    "no-autodownload: true",
    "mkdir -p ${FLATPAK_DEST}/extensions/codecs",
  ]) {
    requireText(text, expected, `manifest must define Flatpak codec extension point: ${expected}`);
  }
  requireText(text, "type: archive", "manifest must use a generated release archive source");
  requireArchiveSource(text);
  if (/type:\s+dir/.test(text)) {
    failures.push("manifest must not use a dir source; run release:flatpak:prepare");
  }
  if (!/sha256:\s+[a-f0-9]{64}/.test(text)) {
    failures.push("manifest archive source must pin sha256");
  }
  for (const expected of [
    "org.freedesktop.Sdk.Extension.node20",
    "org.freedesktop.Sdk.Extension.rust-stable",
    "CARGO_NET_OFFLINE",
    'CI: "true"',
    "COREPACK_HOME",
    ".flatpak-corepack-bin:/usr/lib/sdk/node20/bin",
    "corepack enable --install-directory .flatpak-corepack-bin",
    "corepack install -g --cache-only .flatpak-vendor/corepack.tgz",
    "pnpm install --offline",
    "cargo build --release --locked --offline",
  ]) {
    requireText(text, expected, `manifest must include ${expected}`);
  }
  if (/corepack\s+prepare\s+pnpm@/.test(text)) {
    failures.push("manifest must not prepare pnpm online; vendor it via release:flatpak:prepare");
  }
  for (const forbidden of [
    "--filesystem=host",
    "--filesystem=home",
    "--socket=session-bus",
    "--socket=system-bus",
    "libheif",
    "x265",
    "heif-convert",
    "imgconvert-heic-helper",
  ]) {
    if (text.includes(forbidden)) {
      failures.push(`manifest must not include ${forbidden}`);
    }
  }
}

function inspectPrepareScript(text) {
  for (const expected of [
    '"git",',
    '"archive", "--format=tar", "--output", sourceTreeArchive, "HEAD"',
    'run("tar", ["-xf", sourceTreeArchive, "-C", stagingDir])',
    "patchVendoredDav1dAarch64Meson",
    "aarch64-unknown-linux-gnu.meson",
    ".cargo-checksum.json",
    "aarch64-linux-gnu-gcc",
  ]) {
    requireText(text, expected, `Flatpak prepare script must include ${expected}`);
  }
  if (text.includes('run("rsync"')) {
    failures.push(
      "Flatpak prepare script must archive tracked source instead of rsyncing ignored files",
    );
  }
}

function inspectReadme() {
  const readme = readFileSync(path.join(flatpakDir, "README.md"), "utf8");
  for (const expected of [
    "release:flatpak:prepare",
    "release archive",
    "vendored Cargo/npm",
    "corepack.tgz",
    "IMGCONVERT_PACKAGE_CONVERT_SMOKE=1",
    "IMGCONVERT_ALLOW_FLATPAK_CODEC_EXTENSIONS=1",
    "io.github.yeagoo.imgconvert.Codecs.Heic",
  ]) {
    requireText(readme, expected, `Flatpak README must document ${expected}`);
  }
}

function inspectHeicExtensionTemplate() {
  const manifestTemplatePath = path.join(
    heicExtensionDir,
    "io.github.yeagoo.imgconvert.Codecs.Heic.template.yml",
  );
  const codecManifestPath = path.join(heicExtensionDir, "imgconvert-codec-heic.template.json");
  const metainfoTemplatePath = path.join(
    heicExtensionDir,
    "io.github.yeagoo.imgconvert.Codecs.Heic.metainfo.template.xml",
  );
  const readmePath = path.join(heicExtensionDir, "README.md");
  for (const file of [manifestTemplatePath, codecManifestPath, metainfoTemplatePath, readmePath]) {
    if (!existsSync(file)) {
      failures.push(`missing ${path.relative(repoRoot, file)}`);
    }
  }
  if (!existsSync(manifestTemplatePath) || !existsSync(codecManifestPath)) {
    return;
  }

  const manifestTemplate = readFileSync(manifestTemplatePath, "utf8");
  for (const expected of [
    "id: io.github.yeagoo.imgconvert.Codecs.Heic",
    'branch: "1"',
    "runtime: io.github.yeagoo.imgconvert",
    "build-extension: true",
    "prefix: /app/extensions/codecs/Heic",
    "imgconvert-codec-heic.json",
  ]) {
    requireText(manifestTemplate, expected, `HEIC extension template missing ${expected}`);
  }

  const codecManifest = JSON.parse(readFileSync(codecManifestPath, "utf8"));
  if (codecManifest.protocol !== 1) {
    failures.push("HEIC extension codec manifest must use protocol 1");
  }
  if (!String(codecManifest.license ?? "").startsWith("LGPL-")) {
    failures.push("HEIC extension codec manifest must declare separate LGPL licensing");
  }
  if (!Array.isArray(codecManifest.readable) || !codecManifest.readable.includes("heic")) {
    failures.push("HEIC extension codec manifest must declare HEIC readable support");
  }
  if (Array.isArray(codecManifest.writable) && codecManifest.writable.length > 0) {
    failures.push("HEIC extension codec manifest must stay decode-only");
  }
  if (codecManifest.decode?.kind !== "heic-to-png-file") {
    failures.push("HEIC extension codec manifest must decode HEIC to PNG files");
  }
  if (!codecManifest.decode?.args?.includes("{metadata}")) {
    failures.push("HEIC extension codec manifest should support metadata sidecar output");
  }
}

function requireArchiveSource(text) {
  const localSource =
    /path:\s+\.\.\/\.\.\/target\/flatpak\/sources\/imgconvert-[^\s]+-source\.tar\.gz/.test(text);
  const urlMatch = text.match(/url:\s+(https:\/\/\S+)/);
  if (localSource || urlMatch) {
    if (urlMatch && !/\/imgconvert-[^/]+-source\.tar\.gz$/.test(urlMatch[1])) {
      failures.push("manifest archive url must point at an imgconvert release source archive");
    }
    return;
  }
  failures.push(
    "manifest archive source must point at release:flatpak:prepare output or an HTTPS release archive URL",
  );
}

function inspectDesktop(text) {
  const fields = parseDesktopEntry(text);
  if (fields.Type !== "Application") {
    failures.push("desktop Type must be Application");
  }
  if (fields.Exec !== "imgconvert") {
    failures.push("desktop Exec must be imgconvert");
  }
  if (fields.Icon !== "io.github.yeagoo.imgconvert") {
    failures.push("desktop Icon must use Flatpak app-id");
  }
  if (!fields.Categories?.includes("Graphics") || !fields.Categories?.includes("Photography")) {
    failures.push("desktop Categories must include Graphics and Photography");
  }
}

function inspectMetainfo(text) {
  for (const expected of [
    "<id>io.github.yeagoo.imgconvert</id>",
    "<metadata_license>CC0-1.0</metadata_license>",
    "<project_license>Apache-2.0</project_license>",
    '<developer id="io.github.yeagoo">',
    '<url type="vcs-browser">https://github.com/web-casa/ImgConvert</url>',
    '<launchable type="desktop-id">io.github.yeagoo.imgconvert.desktop</launchable>',
    "<screenshots>",
  ]) {
    requireText(text, expected, `metainfo missing ${expected}`);
  }
  if (text.includes("<developer_name>")) {
    failures.push("metainfo must not use deprecated developer_name");
  }
  for (const forbidden of ["HEIC helper plugins are bundled", "libheif", "x265"]) {
    if (text.includes(forbidden)) {
      failures.push(`metainfo must not imply bundled HEIC codec support: ${forbidden}`);
    }
  }
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) {
    failures.push(message);
  }
}

function parseDesktopEntry(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("[") || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    fields[line.slice(0, index)] = line.slice(index + 1);
  }
  return fields;
}
