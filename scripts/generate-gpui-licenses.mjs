// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const normalize = (text) => `${text.replace(/\r\n?/g, "\n").trimEnd()}\n`;
const read = (path) => normalize(readFileSync(path, "utf8"));
const run = (args) =>
  execFileSync("cargo", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (run(["about", "--version"]).trim() !== "cargo-about 0.9.0") {
  throw new Error("GPUI license generation requires cargo-about 0.9.0");
}
// Fetch every locked target package first. Generation itself uses only packaged
// source files and checked-in supplements, without remote license heuristics.
const tree = run([
  "tree",
  "--manifest-path",
  "apps/gpui/Cargo.toml",
  "--workspace",
  "--all-features",
  "--locked",
  "--target",
  "all",
  "--edges",
  "normal,build,dev",
  "--prefix",
  "none",
  "--format",
  "{p}",
]);
const about = JSON.parse(
  run([
    "about",
    "generate",
    "--workspace",
    "--manifest-path",
    "apps/gpui/Cargo.toml",
    "--config",
    "src-tauri/about.toml",
    "--all-features",
    "--locked",
    "--offline",
    "--fail",
    "--format",
    "json",
  ]),
);
// Cargo tree evaluates active dependency features. Raw metadata also contains
// optional edges activated only by transitive packages' unused dev dependencies.
const covered = new Set(about.crates.map(({ package: pkg }) => `${pkg.name}@${pkg.version}`));
if (covered.size !== about.crates.length)
  throw new Error("Ambiguous package sources: review name/version coverage keys");
for (const line of tree
  .trim()
  .split("\n")
  .filter((record) => record.trim())) {
  const match = /^(\S+) v([^ ]+)/.exec(line.trim());
  if (!match) throw new Error(`Unexpected cargo tree record: ${line}`);
  const id = `${match[1]}@${match[2]}`;
  if (!covered.has(id)) throw new Error(`Missing GPUI attribution: ${id}`);
}
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const key = (pkg) => `${pkg.name}@${pkg.version}`;
const licenseRows = about.licenses
  .map((license) => ({
    id: license.id,
    text: normalize(license.text),
    usedBy: license.used_by.map(({ crate: pkg }) => key(pkg)).sort(compare),
  }))
  .sort((a, b) => compare(`${a.id}:${hash(a.text)}`, `${b.id}:${hash(b.text)}`));
const inventory = about.crates
  .map(({ package: pkg, license }) => ({
    name: pkg.name,
    version: pkg.version,
    license,
    authors: pkg.authors,
    repository: pkg.repository,
    licenseTextHashes: licenseRows
      .filter((row) => row.usedBy.includes(key(pkg)))
      .map((row) => hash(row.text))
      .sort(compare),
  }))
  .sort((a, b) => compare(key(a), key(b)));
for (const pkg of inventory) {
  if (pkg.licenseTextHashes.length === 0) throw new Error(`No license text for ${key(pkg)}`);
}

const appendices = [];
function append(pkg, path) {
  const location = resolve(dirname(pkg.manifest_path), path);
  if (!existsSync(location)) throw new Error(`Missing reviewed license file: ${key(pkg)}/${path}`);
  appendices.push({ source: `${key(pkg)}/${path}`, text: read(location) });
}
// Always preserve packaged NOTICE files, including notices that cargo-about
// does not select as the license expression's representative text.
const fallback = new Set(
  about.licenses
    .filter((license) => !license.source_path)
    .flatMap((license) => license.used_by.map(({ crate: pkg }) => pkg.id)),
);
for (const { package: pkg } of about.crates) {
  for (const name of readdirSync(dirname(pkg.manifest_path)).sort(compare)) {
    if (
      /^notice(?:[._-].*)?$/i.test(name) ||
      (fallback.has(pkg.id) && /^(?:licen[sc]e|copying)(?:[._-].*)?$/i.test(name))
    ) {
      append(pkg, name);
    }
  }
}
// Native sources and bundled icons require their actual copyright/patent
// notices beyond the Rust wrapper's SPDX identifier. See the audit record.
const nativeFiles = {
  "mozjpeg-sys": ["LICENSE"],
  "libwebp-sys": ["vendor/COPYING", "vendor/PATENTS", "vendor/AUTHORS"],
  "libavif-sys": ["libavif/LICENSE"],
  "libaom-sys": [
    "vendor/LICENSE",
    "vendor/PATENTS",
    "vendor/third_party/libyuv/LICENSE",
    "vendor/third_party/x86inc/LICENSE",
    "vendor/third_party/vector/LICENSE",
    "vendor/third_party/fastfeat/LICENSE",
  ],
  rav1e: ["LICENSE", "PATENTS"],
  "libdav1d-sys": ["vendor/COPYING", "vendor/doc/PATENTS"],
  "lcms2-sys": ["vendor/LICENSE"],
  "libdeflate-sys": ["libdeflate/COPYING"],
  "freetype-sys": ["freetype2/docs/FTL.TXT"],
  ring: ["LICENSE", "LICENSE-BoringSSL", "LICENSE-other-bits", "third_party/fiat/LICENSE"],
  "gpui-kit-assets": ["LICENSE-LUCIDE"],
};
for (const [name, paths] of Object.entries(nativeFiles)) {
  const found = about.crates.filter(({ package: pkg }) => pkg.name === name);
  if (found.length === 0)
    throw new Error(`Review native notice inventory after removal of ${name}`);
  for (const { package: pkg } of found) for (const path of paths) append(pkg, path);
}
const upstream = JSON.parse(
  readFileSync(resolve(root, "apps/gpui/licenses/upstream/sources.json"), "utf8"),
);
for (const source of upstream) {
  if (!inventory.some((pkg) => pkg.name === source.crate && pkg.version === source.version)) {
    throw new Error(`Remove or review obsolete upstream supplement: ${source.file}`);
  }
  const text = readFileSync(resolve(root, "apps/gpui/licenses/upstream", source.file), "utf8");
  if (hash(text) !== source.sha256)
    throw new Error(`Upstream supplement hash mismatch: ${source.file}`);
  appendices.push({
    source: `${source.crate}@${source.version} — ${source.url}`,
    text: normalize(text),
  });
}
const unique = [...new Map(appendices.map((item) => [item.source, item])).values()].sort((a, b) =>
  compare(a.source, b.source),
);
const generated = normalize(`# GPUI Third-Party Licenses

Generated by \`pnpm run license:gpui\` using cargo-about 0.9.0, the GPUI lockfile,
and the shared license policy. This conservative all-target, all-feature,
workspace inventory also includes build/test dependencies and the optional updater;
it covers direct and store builds. System frameworks are not redistributed here.
Native/source notice scope is recorded in docs/GPUI_LICENSE_AUDIT.md.

## Project license

${read(resolve(root, "LICENSE"))}
## Project notice

${read(resolve(root, "NOTICE"))}
## Package inventory

${inventory.map((pkg) => `- ${key(pkg)} — ${pkg.license}${pkg.authors.length ? ` — Authors: ${pkg.authors.join("; ")}` : ""}${pkg.repository ? ` — ${pkg.repository}` : ""}`).join("\n")}

## Cargo license texts

${licenseRows.map((row) => `### ${row.id}\n\nUsed by:\n${row.usedBy.map((name) => `- ${name}`).join("\n")}\n\n${row.text}`).join("\n")}
## Supplemental copyright, notice and patent texts

These reproduce published source notices; inclusion of source-tree notices does
not claim that every optional source component is linked into every target.

${unique.map((item) => `### ${item.source}\n\n${item.text}`).join("\n")}
`);
const manifest = `${JSON.stringify(
  {
    schemaVersion: 1,
    generator: "cargo-about 0.9.0 --all-features --offline --locked --fail",
    packages: inventory,
    supplements: unique.map((item) => ({ source: item.source, sha256: hash(item.text) })),
    documentSha256: hash(generated),
  },
  null,
  2,
)}\n`;
for (const [path, text] of [
  ["apps/gpui/THIRD_PARTY_LICENSES.md", generated],
  ["apps/gpui/licenses/inventory.json", manifest],
]) {
  const fullPath = resolve(root, path);
  if (check) {
    if (!existsSync(fullPath) || readFileSync(fullPath, "utf8") !== text)
      throw new Error(`Stale GPUI attributions: ${path}; run pnpm run license:gpui`);
  } else writeFileSync(fullPath, text);
}
console.log(
  `GPUI attributions ${check ? "verified" : "generated"}: ${inventory.length} packages, ${licenseRows.length} license texts, ${unique.length} supplements.`,
);
