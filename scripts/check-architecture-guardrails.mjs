// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const packageJson = readJson("package.json");
const coreCargo = readText("crates/imgconvert-core/Cargo.toml");
const tauriCargo = readText("src-tauri/Cargo.toml");
const workspaceCargo = readText("Cargo.toml");
const denyToml = readText("src-tauri/deny.toml");
const coreLib = readText("crates/imgconvert-core/src/lib.rs");
const tauriLib = readText("src-tauri/src/lib.rs");
const tauriConvert = readText("src-tauri/src/convert.rs");
const tauriImport = readText("src-tauri/src/import.rs");
const externalCodecs = readText("src-tauri/src/external_codecs.rs");
const pdfAdapter = readText("src-tauri/src/pdf.rs");
const tauriBuild = readText("src-tauri/build.rs");
const macosSystemCodecs = readText("src-tauri/src/macos_system_codecs.rs");
const windowsSystemCodecs = readText("src-tauri/src/windows_system_codecs.rs");
const flatpakManifest = readText("packaging/flatpak/io.github.yeagoo.imgconvert.yml");
const coreDependencies = cargoDependencies("crates/imgconvert-core/Cargo.toml");
const tauriDependencies = cargoDependencies("src-tauri/Cargo.toml");

checkPackageManager();
checkLicensingAndDependencies();
checkCoreFormatBoundary();
checkPdfBoundary();
checkTauriCommandSurface();
checkHeicBoundary();
checkStoreExternalCodecBoundary();
checkExplicitFileAccessBoundary();
checkPlatformCheckWiring();

if (failures.length > 0) {
  console.error("architecture guardrail check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("architecture guardrail check passed.");

function checkPackageManager() {
  if (packageJson.license !== "Apache-2.0") {
    failures.push("package.json license must stay Apache-2.0");
  }
  if (!String(packageJson.packageManager ?? "").startsWith("pnpm@")) {
    failures.push("package.json packageManager must stay pinned to pnpm");
  }
  if (!existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) {
    failures.push("pnpm-lock.yaml is required");
  }
  for (const forbiddenLock of ["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock"]) {
    if (existsSync(path.join(repoRoot, forbiddenLock))) {
      failures.push(`do not mix lockfiles; remove ${forbiddenLock}`);
    }
  }
}

function checkLicensingAndDependencies() {
  requireText(coreCargo, 'license = "Apache-2.0"', "imgconvert-core must stay Apache-2.0");
  requireText(tauriCargo, 'license = "Apache-2.0"', "src-tauri must stay Apache-2.0");
  requireText(
    tauriCargo,
    'imgconvert-core = { path = "../crates/imgconvert-core" }',
    "Tauri backend must depend on the local imgconvert-core path crate",
  );
  requireText(
    workspaceCargo,
    'exclude = ["src-tauri", "fuzz"]',
    "workspace must keep Tauri and fuzz crates out of normal core-only workspace checks",
  );

  const coreDeps = dependencyNames(coreDependencies);
  const tauriDeps = dependencyNames(tauriDependencies);
  const forbiddenMainCrates = [
    "dssim",
    "dssim-core",
    "imagequant",
    "libheif",
    "libheif-sys",
    "ravif",
    "vips",
    "libvips",
    "x265",
    "x265-sys",
  ];
  for (const crateName of forbiddenMainCrates) {
    if (coreDeps.has(crateName) || tauriDeps.has(crateName)) {
      failures.push(`forbidden main dependency found in Cargo manifests: ${crateName}`);
    }
  }

  requireDependencyDefaultFeatures(coreDependencies, "image", false);
  requireDependencyDefaultFeatures(coreDependencies, "resvg", false);
  requireDependencyDefaultFeatures(coreDependencies, "libavif-sys", false);
  requireDependencyFeature(coreDependencies, "libavif-sys", "codec-rav1e");
  requireDependencyFeature(coreDependencies, "libavif-sys", "codec-aom");
  requireDependencyFeature(coreDependencies, "libavif-sys", "codec-dav1d");
  requireDependencyWithoutFeature(coreDependencies, "libavif-sys", "x265");
  requireDependencyDefaultFeatures(coreDependencies, "ssimulacra2", false);
  requireDependencyDefaultFeatures(coreDependencies, "lcms2", false);
  requireDependencyFeature(coreDependencies, "lcms2", "static");
  if (!coreDeps.has("color_quant")) {
    failures.push(
      "core must use color_quant instead of imagequant for experimental PNG quantization",
    );
  }

  const packageDeps = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  for (const packageName of packageDeps) {
    if (/imagequant|dssim|libheif|x265|libvips|sharp$/i.test(packageName)) {
      failures.push(`forbidden or native-risk npm dependency found: ${packageName}`);
    }
  }

  const allowedLicenses = cargoDenyAllowedLicenses(denyToml);
  for (const forbiddenLicense of ["GPL-2.0", "GPL-3.0", "AGPL-3.0", "LGPL-2.1", "LGPL-3.0"]) {
    if (allowedLicenses.some((license) => license.includes(forbiddenLicense))) {
      failures.push(`src-tauri/deny.toml must not allow ${forbiddenLicense}`);
    }
  }
  for (const expected of ['unknown-registry = "deny"', 'unknown-git = "deny"', 'yanked = "deny"']) {
    requireText(denyToml, expected, `src-tauri/deny.toml must include ${expected}`);
  }
}

function checkCoreFormatBoundary() {
  for (const forbidden of ["Format::Heic", "Format::Heif", "Format::Hif"]) {
    if (coreLib.includes(forbidden)) {
      failures.push(`imgconvert-core must not define main HEIC format variant: ${forbidden}`);
    }
  }
  requireText(
    coreLib,
    `READABLE_FORMATS: &[Format] = &[
    Format::Jpeg,
    Format::Png,
    Format::WebP,
    Format::Avif,
    Format::Svg,
    Format::Gif,
    Format::Bmp,
]`,
    "core readable formats must include JPEG/PNG/WebP/AVIF plus SVG/static GIF/BMP",
  );
  requireText(
    coreLib,
    "WRITABLE_FORMATS: &[Format] = &[Format::Jpeg, Format::Png, Format::WebP, Format::Avif]",
    "core writable formats must stay JPEG/PNG/WebP/AVIF only",
  );
  requireText(
    coreLib,
    "LOSSLESS_FORMATS: &[Format] = &[Format::Png, Format::WebP, Format::Avif]",
    "core lossless formats must stay PNG/WebP/AVIF",
  );
}

function checkPdfBoundary() {
  const coreDeps = dependencyNames(coreDependencies);
  const tauriDeps = dependencyNames(tauriDependencies);
  if (coreDeps.has("hayro")) {
    failures.push("PDF rendering must stay at the Tauri adapter boundary, outside imgconvert-core");
  }
  if (!tauriDeps.has("hayro")) {
    failures.push("Tauri PDF adapter must retain the pure-Rust hayro renderer dependency");
  }
  for (const forbidden of ["pdfium-render", "pdfium-sys", "poppler", "poppler-sys"]) {
    if (coreDeps.has(forbidden) || tauriDeps.has(forbidden)) {
      failures.push(`PDF conversion must not add a runtime native PDF dependency: ${forbidden}`);
    }
  }
  requireText(
    tauriConvert,
    'readable.push("pdf")',
    "PDF must remain a read-only input capability at the Tauri boundary",
  );
  requireText(
    tauriConvert,
    "writable: format_ids(WRITABLE_FORMATS)",
    "PDF must not enter the writable output capability list",
  );
  for (const marker of [
    "MAX_PDF_SOURCE_BYTES",
    "MAX_SELECTED_PDF_PAGES",
    "MAX_PDF_PAGE_RANGE_CHARS",
    "validate_pixel_budget",
    "catch_pdf_unwind",
    "warning_sink",
  ]) {
    requireText(pdfAdapter, marker, `PDF adapter must retain safety marker: ${marker}`);
  }
  for (const marker of [
    "PDF_IMPORT_PROBE_MAX_BYTES",
    "PDF_IMPORT_TOTAL_PROBE_BYTES",
    "read_pdf_file_with_limit",
    "if self.should_stop()",
  ]) {
    requireText(
      tauriImport,
      marker,
      `PDF import scanning must retain its bounded/cancellable probe marker: ${marker}`,
    );
  }
}

function checkTauriCommandSurface() {
  requireText(
    tauriLib,
    "async fn convert_batch(",
    "the frontend conversion path must retain the batch command",
  );
  if (/\bconvert_image\b/u.test(tauriLib)) {
    failures.push("unused convert_image must not be exposed as a second conversion IPC command");
  }
}

function checkHeicBoundary() {
  requireText(
    tauriConvert,
    'const HEIC_OUTPUT_DISABLED_PREFIX: &str = "HEIC 输出暂未启用";',
    "Tauri output parser must keep a stable HEIC/HEIF rejection prefix",
  );
  requireText(
    tauriConvert,
    '"heic" | "heif" => Err(format!(',
    "Tauri output parser must reject HEIC/HEIF targets",
  );
  requireText(
    tauriConvert,
    '"{HEIC_OUTPUT_DISABLED_PREFIX};当前仅作为可选导入格式"',
    "Tauri output parser must reject HEIC/HEIF targets",
  );
  requireText(
    tauriConvert,
    "writable: format_ids(WRITABLE_FORMATS)",
    "Tauri capabilities writable list must come only from core WRITABLE_FORMATS",
  );
  requireText(
    tauriConvert,
    'assert!(!capabilities.writable.contains(&"heic"))',
    "Tauri tests must guard HEIC as read-only capability",
  );

  for (const [label, source] of [
    ["macOS ImageIO", macosSystemCodecs],
    ["Windows WIC", windowsSystemCodecs],
  ]) {
    requireText(source, "writable: Vec::new()", `${label} HEIC provider must remain read-only`);
    requireText(
      source,
      "provider.writable.is_empty()",
      `${label} tests must assert HEIC provider writable is empty`,
    );
  }

  requireText(
    externalCodecs,
    "if !manifest.writable.is_empty()",
    "external codec manifests must reject writable HEIC providers",
  );
  requireText(
    externalCodecs,
    "manifest_rejects_writable_heic",
    "external codec tests must reject writable HEIC manifests",
  );

  const flatpakHeicManifest = readJson(
    "packaging/flatpak/extensions/heic/imgconvert-codec-heic.json",
  );
  if (!Array.isArray(flatpakHeicManifest.writable) || flatpakHeicManifest.writable.length !== 0) {
    failures.push("Flatpak HEIC extension manifest must stay decode-only with writable: []");
  }
  if (!String(flatpakHeicManifest.license ?? "").startsWith("LGPL-")) {
    failures.push("Flatpak HEIC extension may be LGPL only as a separate extension");
  }
}

function checkStoreExternalCodecBoundary() {
  requireText(
    tauriBuild,
    "rerun-if-env-changed=IMGCONVERT_DISABLE_EXTERNAL_CODECS",
    "Tauri build script must rerun when external codec disable flag changes",
  );
  requireText(
    externalCodecs,
    'option_env!("IMGCONVERT_DISABLE_EXTERNAL_CODECS")',
    "external codec discovery must support compile-time disable for store builds",
  );
  requireText(
    externalCodecs,
    "return flatpak_extension_dirs",
    "disabled external codec discovery must still only allow Flatpak extension dirs",
  );

  const scripts = packageJson.scripts ?? {};
  requireScriptIncludes("release:store-env:check", "--require-store-env");
  requireScriptIncludes("release:macos:store:check", "--require-store-env");
  requireScriptIncludes("release:windows:store:check", "--require-store-env");
  requireScriptIncludes("release:macos:mas", "IMGCONVERT_DISABLE_EXTERNAL_CODECS=1");
  if (!scripts["quality:security"]?.includes("architecture:check")) {
    failures.push("quality:security must include architecture:check");
  }

  requireText(
    flatpakManifest,
    'IMGCONVERT_DISABLE_EXTERNAL_CODECS: "1"',
    "Flatpak build env must disable host external codec helpers",
  );
  requireText(
    flatpakManifest,
    "--env=IMGCONVERT_DISABLE_EXTERNAL_CODECS=1",
    "Flatpak runtime env must disable host external codec helpers",
  );
  for (const forbidden of ["libheif", "x265", "heif-convert", "imgconvert-heic-helper"]) {
    if (flatpakManifest.includes(forbidden)) {
      failures.push(`Flatpak main package must not bundle HEIC helper material: ${forbidden}`);
    }
  }
}

function checkExplicitFileAccessBoundary() {
  const access = readText("src-tauri/src/access.rs");
  requireText(access, "pub struct AuthorizedPath", "file access must stay behind AuthorizedPath");
  requireText(access, "pub fn user_selected_paths", "imports must go through user-selected grants");
  requireText(access, "pub fn output_directory", "output dirs must go through access grants");
  requireText(access, "pub fn scoped_path_access", "path use must retain scoped access hook");
  requireText(
    tauriImport,
    "scanner.scan(resolved.authorized);",
    "import scanner must consume user-selected path grants",
  );
  requireText(
    tauriImport,
    "for rejected in resolved.rejected",
    "import scanner must report rejected user-selected paths",
  );
  requireText(
    tauriConvert,
    "access::output_directory(opts.out_dir.as_deref())",
    "conversion output directory must use access grants",
  );
  requireText(
    tauriConvert,
    "access::scoped_path_access(input)",
    "conversion input must start scoped access before reading",
  );
}

function checkPlatformCheckWiring() {
  const scripts = packageJson.scripts ?? {};
  if (!scripts["architecture:check"]?.includes("check-architecture-guardrails.mjs")) {
    failures.push("package.json must expose architecture:check");
  }
  if (!scripts["release:platform:check"]?.includes("architecture:check")) {
    failures.push("release:platform:check must run architecture:check first");
  }
  const platformGuardrail = readText("scripts/check-platform-release-guardrails.mjs");
  requireText(
    platformGuardrail,
    "checkArchitectureGuardrailWiring",
    "platform release guardrail must verify architecture guardrail wiring",
  );
}

function requireScriptIncludes(scriptName, needle) {
  const script = packageJson.scripts?.[scriptName] ?? "";
  if (!script.includes(needle)) {
    failures.push(`package.json ${scriptName} must include ${needle}`);
  }
}

function cargoDependencies(manifest) {
  const manifestPath = path.join(repoRoot, manifest);
  try {
    const output = execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifestPath],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const metadata = JSON.parse(output);
    const packageEntry = metadata.packages?.find(
      (entry) => path.resolve(entry.manifest_path) === path.resolve(manifestPath),
    );
    if (!packageEntry || !Array.isArray(packageEntry.dependencies)) {
      throw new Error("manifest package was not returned by cargo metadata");
    }
    return packageEntry.dependencies;
  } catch (error) {
    failures.push(`failed to parse ${manifest} with cargo metadata: ${String(error)}`);
    return [];
  }
}

function dependencyNames(dependencies) {
  const names = new Set();
  for (const dependency of dependencies) {
    names.add(dependency.name);
    if (dependency.rename) names.add(dependency.rename);
  }
  return names;
}

function cargoDependency(dependencies, name) {
  const normalizedName = name.replaceAll("-", "_");
  return dependencies.find((dependency) => {
    const declaredName = dependency.rename ?? dependency.name;
    return declaredName.replaceAll("-", "_") === normalizedName;
  });
}

function requireDependencyDefaultFeatures(dependencies, name, expected) {
  const dependency = cargoDependency(dependencies, name);
  if (!dependency) {
    failures.push(`missing Cargo dependency: ${name}`);
  } else if (dependency.uses_default_features !== expected) {
    failures.push(`Cargo dependency ${name} uses_default_features must be ${expected}`);
  }
}

function requireDependencyFeature(dependencies, name, feature) {
  const dependency = cargoDependency(dependencies, name);
  if (!dependency) {
    failures.push(`missing Cargo dependency: ${name}`);
  } else if (!dependency.features.includes(feature)) {
    failures.push(`Cargo dependency ${name} must include feature ${feature}`);
  }
}

function requireDependencyWithoutFeature(dependencies, name, feature) {
  const dependency = cargoDependency(dependencies, name);
  if (dependency?.features.includes(feature)) {
    failures.push(`Cargo dependency ${name} must not include feature ${feature}`);
  }
}

function cargoDenyAllowedLicenses(toml) {
  const match = toml.match(/allow\s*=\s*\[([\s\S]*?)]/);
  if (!match) {
    failures.push("src-tauri/deny.toml must define licenses.allow");
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((license) => license[1]);
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) {
    failures.push(message);
  }
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}
