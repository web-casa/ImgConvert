// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  platforms: ["macos", "windows"],
  channels: ["direct", "store"],
  requireStoreEnv: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--platform=")) {
    const value = arg.slice("--platform=".length).toLowerCase();
    options.platforms =
      value === "all" ? ["macos", "windows"] : splitOption(value, ["macos", "windows"]);
  } else if (arg.startsWith("--channel=")) {
    const value = arg.slice("--channel=".length).toLowerCase();
    options.channels =
      value === "all" ? ["direct", "store"] : splitOption(value, ["direct", "store"]);
  } else if (arg === "--require-store-env") {
    options.requireStoreEnv = true;
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

const packageJson = readJson(path.join(repoRoot, "package.json"));
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const tauriConfig = readJson(tauriConfigPath);
const srcTauriRoot = path.join(repoRoot, "src-tauri");
const failures = [];

checkCommonBundleMetadata();
checkArchitectureGuardrailWiring();
checkReadmeStatusGuardrails();
checkReleaseReadinessGuardrails();
checkAvifLosslessGuardrails();
checkSemanticMetadataGuardrails();
checkPlatformBenchmarkGuardrails();
checkImageQualityGuardrails();
checkProbeMetadataGuardrails();
checkFuzzCorpusGuardrails();
checkTauriUpdaterGuardrails();
checkFlatpakHeicExtensionGuardrails();
checkFlathubReleaseGuardrails();

if (options.platforms.includes("macos")) {
  checkMacos();
}
if (options.platforms.includes("windows")) {
  checkWindows();
}
if (options.channels.includes("store")) {
  checkStoreCodecGuardrail();
}

if (failures.length > 0) {
  console.error("platform release guardrail check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `platform release guardrail check passed (${options.platforms.join(", ")}; ${options.channels.join(", ")}).`,
);

function checkCommonBundleMetadata() {
  if (tauriConfig.version !== packageJson.version) {
    failures.push(
      `tauri.conf.json version ${tauriConfig.version ?? "<missing>"} does not match package.json ${packageJson.version}`,
    );
  }
  if (!tauriConfig.productName?.trim()) {
    failures.push("tauri.conf.json productName is required");
  }
  if (!/^([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$/.test(tauriConfig.identifier ?? "")) {
    failures.push("tauri.conf.json identifier must be a reverse-DNS id");
  }
  if (tauriConfig.bundle?.active !== true) {
    failures.push("tauri.conf.json bundle.active must be true for platform releases");
  }
  if (tauriConfig.bundle?.license !== "Apache-2.0") {
    failures.push("tauri.conf.json bundle.license must stay Apache-2.0");
  }

  const licenseFile = tauriConfig.bundle?.licenseFile;
  if (!licenseFile) {
    failures.push("tauri.conf.json bundle.licenseFile is required");
  } else if (!existsSync(path.resolve(repoRoot, "src-tauri", licenseFile))) {
    failures.push(`bundle.licenseFile does not exist: ${licenseFile}`);
  }

  if (!Array.isArray(tauriConfig.bundle?.icon) || tauriConfig.bundle.icon.length === 0) {
    failures.push("tauri.conf.json bundle.icon must include platform icons");
  }
}

function checkArchitectureGuardrailWiring() {
  const packageScripts = packageJson.scripts ?? {};
  const architectureScript = readText(
    path.join(repoRoot, "scripts", "check-architecture-guardrails.mjs"),
  );
  if (!packageScripts["architecture:check"]?.includes("check-architecture-guardrails.mjs")) {
    failures.push("package.json must expose architecture:check");
  }
  if (!packageScripts["release:platform:check"]?.includes("architecture:check")) {
    failures.push("release:platform:check must run architecture:check first");
  }
  for (const expected of [
    "checkLicensingAndDependencies",
    "checkCoreFormatBoundary",
    "checkHeicBoundary",
    "checkStoreExternalCodecBoundary",
    "checkExplicitFileAccessBoundary",
  ]) {
    if (!architectureScript.includes(expected)) {
      failures.push(`architecture guardrail script missing marker: ${expected}`);
    }
  }
}

function checkReleaseReadinessGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  const readinessScript = readText(path.join(repoRoot, "scripts", "report-release-readiness.mjs"));
  const roadmap = readText(path.join(repoRoot, "docs", "ROADMAP.md"));
  const engine = readText(path.join(repoRoot, "docs", "ENGINE.md"));
  const ciCosts = readText(path.join(repoRoot, "docs", "CI_COSTS.md"));

  if (!packageScripts["release:readiness"]?.includes("report-release-readiness.mjs")) {
    failures.push("package.json must expose release:readiness");
  }
  if (
    !packageScripts["release:readiness:check"]?.includes("report-release-readiness.mjs --check")
  ) {
    failures.push("package.json must expose release:readiness:check");
  }
  if (!packageScripts["release:readiness:github:ready"]?.includes("--require-publishable")) {
    failures.push("package.json must expose release:readiness:github:ready");
  }
  if (!packageScripts["release:platform:check"]?.includes("release:readiness:check")) {
    failures.push("release:platform:check must run release:readiness:check");
  }
  for (const expected of [
    "--json",
    "--check",
    "--require-ready",
    "--require-publishable",
    "docs:check",
    "TAURI_UPDATER_PUBKEY",
    "TAURI_SIGNING_PRIVATE_KEY",
    "WINDOWS_CERTIFICATE_BASE64",
    "IMGCONVERT_MAS_PROVISION_PROFILE",
    "flathub-main-submission",
    "real-image-corpus-fuzz",
    "windows-platform-benchmark",
    "release:platform:check",
    "release:flatpak:verify",
    "bench:avif:macos",
    "does not build artifacts",
  ]) {
    if (!readinessScript.includes(expected)) {
      failures.push(`release readiness report missing marker: ${expected}`);
    }
  }
  for (const [name, text] of [
    ["docs/ROADMAP.md", roadmap],
    ["docs/ENGINE.md", engine],
    ["docs/CI_COSTS.md", ciCosts],
  ]) {
    if (!text.includes("release:readiness")) {
      failures.push(`${name} must document release:readiness`);
    }
  }
}

function checkReadmeStatusGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  const readmeScriptPath = path.join(repoRoot, "scripts", "check-readme-status.mjs");
  const readmeScript = readText(readmeScriptPath);
  const readme = readText(path.join(repoRoot, "README.md"));
  const ci = readText(path.join(repoRoot, ".github", "workflows", "ci.yml"));

  if (!packageScripts["docs:check"]?.includes("check-readme-status.mjs")) {
    failures.push("package.json must expose docs:check");
  }
  if (!packageScripts["quality:security"]?.includes("docs:check")) {
    failures.push("quality:security must include docs:check");
  }
  if (!ci.includes("pnpm run docs:check")) {
    failures.push("ci.yml must run docs:check");
  }
  for (const expected of [
    "当前为前端串行",
    "Rust 端批量转换",
    "真实发布验收",
    "release:readiness",
    "release:platform:check",
  ]) {
    if (!readmeScript.includes(expected)) {
      failures.push(`README status guardrail missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "Rust 端批量转换",
    "AVIF 真无损",
    "Tauri updater",
    "外部验收",
    "pnpm run release:readiness",
  ]) {
    if (!readme.includes(expected)) {
      failures.push(`README missing current status marker: ${expected}`);
    }
  }
}

function checkAvifLosslessGuardrails() {
  const coreCargo = readText(path.join(repoRoot, "crates", "imgconvert-core", "Cargo.toml"));
  const coreLib = readText(path.join(repoRoot, "crates", "imgconvert-core", "src", "lib.rs"));
  const tauriConvert = readText(path.join(repoRoot, "src-tauri", "src", "convert.rs"));
  const stateTs = readText(path.join(repoRoot, "src", "lib", "state.svelte.ts"));
  const thirdParty = readText(path.join(repoRoot, "THIRD_PARTY_LICENSES.md"));

  if (!coreCargo.includes('"codec-aom"')) {
    failures.push("AVIF lossless requires libavif-sys codec-aom feature");
  }
  if (!coreLib.includes("AVIF_LOSSLESS_SUPPORTED: bool = true")) {
    failures.push("AVIF lossless capability flag must stay enabled only after pixel tests pass");
  }
  if (
    !coreLib.includes("LOSSLESS_FORMATS: &[Format] = &[Format::Png, Format::WebP, Format::Avif]")
  ) {
    failures.push("AVIF must be included in core LOSSLESS_FORMATS");
  }
  if (!coreLib.includes("AVIF_CODEC_CHOICE_AOM")) {
    failures.push("AVIF lossless encode path must choose AOM, not rav1e");
  }
  if (!tauriConvert.includes("target == Format::Avif && !encode_options.lossless")) {
    failures.push("generation loss guard must not treat AVIF lossless targets as lossy");
  }
  if (!stateTs.includes('lossless: ["png", "webp", "avif"]')) {
    failures.push("frontend fallback capabilities must include AVIF lossless");
  }
  if (!thirdParty.includes("libaom-sys")) {
    failures.push("THIRD_PARTY_LICENSES.md must be regenerated after adding libaom-sys");
  }
}

function checkSemanticMetadataGuardrails() {
  const coreLib = readText(path.join(repoRoot, "crates", "imgconvert-core", "src", "lib.rs"));
  const tauriConvert = readText(path.join(repoRoot, "src-tauri", "src", "convert.rs"));
  const externalCodecs = readText(path.join(repoRoot, "src-tauri", "src", "external_codecs.rs"));

  for (const expected of [
    "pub iptc: Option<Vec<u8>>",
    "inspect_metadata_semantics",
    "MetadataSemanticReport",
    "ExifMakerNoteSummary",
    "IptcDatasetSummary",
    "JPEG_IPTC_RESOURCE_ID",
    "extract_jpeg_photoshop_iptc",
    "write_jpeg_iptc_segment",
    "fn extract_avif_metadata",
    "fn avif_metadata_from_image",
    "metadata_from_image_format(&av, Format::Avif)",
    "xml_prefixes_for_namespace",
    "xmp_semantic_cleanup_handles_namespace_aliases",
    "metadata_semantics_report_detects_iptc_and_makernote_without_rewriting_private_bytes",
  ]) {
    if (!coreLib.includes(expected)) {
      failures.push(`semantic metadata guardrail missing core marker: ${expected}`);
    }
  }

  if (!tauriConvert.includes('hash_optional_metadata_blob(hasher, b"iptc"')) {
    failures.push("result cache key must include IPTC metadata override blobs");
  }
  if (!externalCodecs.includes("iptc: Option<String>")) {
    failures.push("HEIC metadata sidecar must keep optional IPTC blob support");
  }
}

function checkPlatformBenchmarkGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  const benchmarkScript = readText(path.join(repoRoot, "scripts", "benchmark-platform.mjs"));
  const macosBenchmarkScript = readText(path.join(repoRoot, "scripts", "benchmark-macos-avif.mjs"));
  const coreLib = readText(path.join(repoRoot, "crates", "imgconvert-core", "src", "lib.rs"));
  const tauriConvert = readText(path.join(repoRoot, "src-tauri", "src", "convert.rs"));

  if (!packageScripts["bench:platform"]?.includes("benchmark-platform.mjs")) {
    failures.push("package.json must expose bench:platform for AVIF/WebP platform timing");
  }
  if (!benchmarkScript.includes('profile: "release"')) {
    failures.push("benchmark-platform must default to release profile for real timing data");
  }
  if (!benchmarkScript.includes('"--release"')) {
    failures.push("benchmark-platform must run cargo with --release by default");
  }
  if (!benchmarkScript.includes("recommendations: recommendDefaults")) {
    failures.push("benchmark-platform must emit default-parameter recommendations");
  }
  if (!benchmarkScript.includes('path.join("target", "benchmarks"')) {
    failures.push("benchmark-platform must persist JSON reports under target/benchmarks");
  }
  if (!macosBenchmarkScript.includes("benchmark-platform.mjs")) {
    failures.push("benchmark-macos-avif must reuse platform benchmark reporting");
  }
  if (!coreLib.includes("convert_best_of_with_color_policy_timeout")) {
    failures.push("imgconvert-core must expose a timed best-of conversion entry");
  }
  if (!coreLib.includes("convert_auto_quality_with_color_policy_timeout")) {
    failures.push("imgconvert-core must expose a timed auto-quality conversion entry");
  }
  if (!tauriConvert.includes("IMGCONVERT_CONVERT_TIMEOUT_SECONDS")) {
    failures.push("Tauri convert path must support a wall-clock timeout override");
  }
  if (!tauriConvert.includes("convert_wall_clock_timeout_seconds")) {
    failures.push("runtime diagnostics must expose the convert wall-clock timeout");
  }
}

function checkImageQualityGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  const coreLib = readText(path.join(repoRoot, "crates", "imgconvert-core", "src", "lib.rs"));
  const imageQualityTest = readText(
    path.join(repoRoot, "crates", "imgconvert-core", "tests", "image_quality.rs"),
  );

  if (!packageScripts["test:image-quality"]?.includes("check-image-quality.mjs")) {
    failures.push("package.json must expose test:image-quality for deterministic quality tests");
  }
  for (const expected of [
    "pub webp_block_score: f64",
    "pub jpeg_chroma_grid_score: f64",
    "JPEG_CHROMA_GRID_ARTIFACT_SCORE_THRESHOLD",
    "jpeg_chroma_grid_artifact_score",
    "WEBP_BLOCK_ARTIFACT_SCORE_THRESHOLD",
    "webp_block_artifact_score",
    "block_boundary_artifact_score",
    "lossy_artifact_hint_detects_png_jpeg_chroma_grid",
    "lossy_artifact_hint_detects_png_webp_like_blocks",
  ]) {
    if (!coreLib.includes(expected)) {
      failures.push(`image quality guardrail missing core marker: ${expected}`);
    }
  }
  for (const expected of [
    "quality_artifact_hint_detects_block_artifact_corpus_fixtures",
    "webp_like_block_fixture",
    "jpeg_chroma_grid_fixture",
    "jpeg_chroma_grid_score",
    "webp_block_score",
  ]) {
    if (!imageQualityTest.includes(expected)) {
      failures.push(`image quality guardrail missing integration marker: ${expected}`);
    }
  }
}

function checkProbeMetadataGuardrails() {
  const coreLib = readText(path.join(repoRoot, "crates", "imgconvert-core", "src", "lib.rs"));
  for (const expected of [
    "fn parse_exif_dpi",
    "fn tiff_entry_rational_value",
    "fn probe_webp_exif_dpi",
    "fn probe_avif_exif_dpi",
    "parse_exif_dpi_accepts_optional_exif_prefix",
    "probe_jpeg_reads_exif_resolution_dpi",
    "probe_webp_reads_exif_resolution_dpi",
    "probe_avif_reads_exif_resolution_dpi",
    "exif_with_resolution",
  ]) {
    if (!coreLib.includes(expected)) {
      failures.push(`probe metadata guardrail missing core marker: ${expected}`);
    }
  }
}

function checkFuzzCorpusGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  const workspaceCargo = readText(path.join(repoRoot, "Cargo.toml"));
  const fuzzCargo = readText(path.join(repoRoot, "fuzz", "Cargo.toml"));
  const prepareScriptPath = path.join(repoRoot, "scripts", "prepare-fuzz-corpus.mjs");
  const replayScriptPath = path.join(repoRoot, "scripts", "replay-fuzz-corpus.mjs");
  const minimizeScriptPath = path.join(repoRoot, "scripts", "minimize-fuzz-artifacts.mjs");
  const prepareScript = readText(prepareScriptPath);
  const replayScript = readText(replayScriptPath);
  const minimizeScript = readText(minimizeScriptPath);
  const replayExample = readText(
    path.join(repoRoot, "crates", "imgconvert-core", "examples", "replay_fuzz_corpus.rs"),
  );
  const fuzzCorpusIgnore = readText(path.join(repoRoot, "fuzz", "corpus", ".gitignore")).replaceAll(
    "\r\n",
    "\n",
  );
  const realCorpusIgnore = readText(path.join(repoRoot, "corpus", "real", ".gitignore")).replaceAll(
    "\r\n",
    "\n",
  );

  if (!workspaceCargo.includes('"fuzz"')) {
    failures.push("workspace Cargo.toml must exclude fuzz from normal workspace builds");
  }
  for (const scriptName of [
    "fuzz:prepare",
    "fuzz:prepare:require-real",
    "fuzz:check",
    "fuzz:replay",
    "fuzz:minimize",
    "fuzz:minimize:run",
    "fuzz:smoke",
    "fuzz:ci",
  ]) {
    if (!packageScripts[scriptName]) {
      failures.push(`package.json must expose ${scriptName}`);
    }
  }
  if (!packageScripts["fuzz:smoke"]?.includes("fuzz:replay")) {
    failures.push("fuzz:smoke must replay prepared corpus, not only compile targets");
  }
  for (const target of ["decode_pipeline", "convert_pipeline", "metadata_semantics"]) {
    if (!fuzzCargo.includes(`name = "${target}"`)) {
      failures.push(`fuzz/Cargo.toml must define ${target} fuzz target`);
    }
    if (!existsSync(path.join(repoRoot, "fuzz", "fuzz_targets", `${target}.rs`))) {
      failures.push(`fuzz target source missing: ${target}.rs`);
    }
  }
  if (!fuzzCargo.includes("libfuzzer-sys")) {
    failures.push("fuzz/Cargo.toml must use libfuzzer-sys");
  }
  if (!existsSync(prepareScriptPath) || !prepareScript.includes("IMGCONVERT_REAL_CORPUS_DIRS")) {
    failures.push("prepare-fuzz-corpus must support local real corpus directories");
  }
  if (
    !prepareScript.includes("corpus/real") ||
    !prepareScript.includes("real-corpus-manifest.json")
  ) {
    failures.push("prepare-fuzz-corpus must import corpus/real and write a local manifest");
  }
  if (
    !existsSync(replayScriptPath) ||
    !replayScript.includes("replay_fuzz_corpus") ||
    !replayScript.includes("replay-report.json")
  ) {
    failures.push("replay-fuzz-corpus must run the Rust replay example and persist a report");
  }
  if (
    !existsSync(minimizeScriptPath) ||
    !minimizeScript.includes('"fuzz", "tmin"') ||
    !minimizeScript.includes("minimize-report.json") ||
    !minimizeScript.includes("--dry-run")
  ) {
    failures.push("minimize-fuzz-artifacts must support dry-run tmin planning and reports");
  }
  if (
    !replayExample.includes("convert_best_of_with_color_policy_timeout") ||
    !replayExample.includes("inspect_metadata_semantics") ||
    !replayExample.includes("catch_unwind")
  ) {
    failures.push("replay_fuzz_corpus example must cover convert, metadata, and panic capture");
  }
  if (!fuzzCorpusIgnore.startsWith("*\n") || !realCorpusIgnore.startsWith("*\n")) {
    failures.push("local fuzz and real corpus directories must ignore generated/private images");
  }
}

function checkTauriUpdaterGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  const packageDependencies = packageJson.dependencies ?? {};
  const tauriCargo = readText(path.join(repoRoot, "src-tauri", "Cargo.toml"));
  const tauriLib = readText(path.join(repoRoot, "src-tauri", "src", "lib.rs"));
  const tauriBuild = readText(path.join(repoRoot, "src-tauri", "build.rs"));
  const capabilities = readText(path.join(repoRoot, "src-tauri", "capabilities", "default.json"));
  const updaterCapabilities = readText(
    path.join(repoRoot, "src-tauri", "capabilities", "updater.json"),
  );
  const stateTs = readText(path.join(repoRoot, "src", "lib", "state.svelte.ts"));
  const updateDialog = readText(
    path.join(repoRoot, "src", "lib", "components", "UpdateDialog.svelte"),
  );
  const updaterWorkflow = readText(
    path.join(repoRoot, ".github", "workflows", "release-updater.yml"),
  );
  const prepareScript = readText(
    path.join(repoRoot, "scripts", "prepare-tauri-updater-release.mjs"),
  );
  const manifestScript = readText(
    path.join(repoRoot, "scripts", "generate-tauri-updater-manifest.mjs"),
  );
  const verifyScript = readText(path.join(repoRoot, "scripts", "check-tauri-updater-manifest.mjs"));
  const signScript = readText(path.join(repoRoot, "scripts", "sign-tauri-updater-artifacts.mjs"));
  const linuxUpdaterScript = readText(path.join(repoRoot, "scripts", "release-linux-updater.mjs"));
  const smokeScript = readText(path.join(repoRoot, "scripts", "smoke-tauri-updater-release.mjs"));
  const upgradeSmokeScript = readText(
    path.join(repoRoot, "scripts", "smoke-tauri-in-app-updater.mjs"),
  );
  const updaterDocs = readText(path.join(repoRoot, "docs", "UPDATER.md"));
  const upgradeSmokeWorkflow = readText(
    path.join(repoRoot, ".github", "workflows", "updater-upgrade-smoke.yml"),
  );

  if (!packageScripts["release:updater:prepare"]?.includes("prepare-tauri-updater-release.mjs")) {
    failures.push("package.json must expose release:updater:prepare");
  }
  if (!packageScripts["release:updater:sign"]?.includes("sign-tauri-updater-artifacts.mjs")) {
    failures.push("package.json must expose release:updater:sign");
  }
  if (
    !packageScripts["release:updater:manifest"]?.includes("generate-tauri-updater-manifest.mjs")
  ) {
    failures.push("package.json must expose release:updater:manifest");
  }
  if (!packageScripts["release:updater:verify"]?.includes("check-tauri-updater-manifest.mjs")) {
    failures.push("package.json must expose release:updater:verify");
  }
  if (!packageScripts["release:updater:smoke"]?.includes("smoke-tauri-updater-release.mjs")) {
    failures.push("package.json must expose release:updater:smoke");
  }
  if (!packageScripts["release:updater:upgrade-smoke"]?.includes("--require-gui")) {
    failures.push("package.json must expose release:updater:upgrade-smoke as a real GUI smoke");
  }
  if (
    !packageScripts["release:updater:upgrade-smoke:eligibility"]?.includes("--eligibility-only")
  ) {
    failures.push("package.json must expose release:updater:upgrade-smoke:eligibility");
  }
  if (!packageScripts["release:linux:updater"]?.includes("release-linux-updater.mjs")) {
    failures.push("package.json must expose release:linux:updater via release-linux-updater.mjs");
  }
  if (!packageScripts["release:updater:local"]?.includes("release:updater:manifest")) {
    failures.push("package.json must expose release:updater:local with latest.json generation");
  }
  if (!packageDependencies["@tauri-apps/plugin-updater"]) {
    failures.push("package.json must include @tauri-apps/plugin-updater for UI checks");
  }
  if (!packageDependencies["@tauri-apps/plugin-process"]) {
    failures.push("package.json must include @tauri-apps/plugin-process for updater relaunch");
  }
  if (!tauriCargo.includes("tauri-plugin-updater")) {
    failures.push("src-tauri/Cargo.toml must include tauri-plugin-updater");
  }
  if (!tauriCargo.includes("tauri-plugin-process")) {
    failures.push("src-tauri/Cargo.toml must include tauri-plugin-process");
  }
  if (!tauriLib.includes('option_env!("IMGCONVERT_DISABLE_UPDATER")')) {
    failures.push("Tauri builder must compile out updater when IMGCONVERT_DISABLE_UPDATER=1");
  }
  if (!tauriBuild.includes("rerun-if-env-changed=IMGCONVERT_DISABLE_UPDATER")) {
    failures.push("src-tauri/build.rs must rerun when IMGCONVERT_DISABLE_UPDATER changes");
  }
  if (!stateTs.includes("VITE_IMGCONVERT_DISABLE_UPDATER")) {
    failures.push("frontend must hide updater UI when IMGCONVERT_DISABLE_UPDATER=1");
  }
  if (!packageScripts["release:macos:mas"]?.includes("IMGCONVERT_DISABLE_UPDATER=1")) {
    failures.push("release:macos:mas must disable updater");
  }
  if (!packageScripts["release:windows:msix"]?.includes("tauri.store.generated.conf.json")) {
    failures.push("release:windows:msix must use the Store Tauri config");
  }
  if (!tauriLib.includes("tauri_plugin_process::init()")) {
    failures.push("Tauri builder must register tauri-plugin-process for relaunch");
  }
  if (capabilities.includes('"updater:default"')) {
    failures.push("default capability must not expose updater; store builds use default only");
  }
  if (!updaterCapabilities.includes('"updater:default"')) {
    failures.push("updater capability must expose updater:default for direct builds");
  }
  if (!capabilities.includes('"process:allow-restart"')) {
    failures.push("Tauri capabilities must expose process:allow-restart only");
  }
  const defaultUpdater = tauriConfig.plugins?.updater;
  if (
    !defaultUpdater ||
    defaultUpdater.pubkey !== "" ||
    !Array.isArray(defaultUpdater.endpoints) ||
    defaultUpdater.endpoints.length !== 0
  ) {
    failures.push(
      "default tauri.conf.json must keep updater config inert (empty pubkey/endpoints)",
    );
  }
  for (const expected of [
    "TAURI_UPDATER_PUBKEY",
    "TAURI_UPDATER_ENDPOINTS",
    "createUpdaterArtifacts",
    "tauri.updater.generated.conf.json",
  ]) {
    if (!prepareScript.includes(expected)) {
      failures.push(`prepare-tauri-updater-release missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "TAURI_UPDATER_ARTIFACT_BASE_URL",
    ".appimage",
    ".appimage.tar.gz",
    ".msi",
    ".exe",
    ".sig",
    "latest.json",
  ]) {
    if (!manifestScript.includes(expected)) {
      failures.push(`generate-tauri-updater-manifest missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "TAURI_UPDATER_ARTIFACT_BASE_URL",
    "latest.json",
    ".appimage",
    ".exe",
    ".sig",
    "signature does not match",
  ]) {
    if (!verifyScript.includes(expected)) {
      failures.push(`check-tauri-updater-manifest missing marker: ${expected}`);
    }
  }
  for (const expected of ["TAURI_SIGNING_PRIVATE_KEY", "tauri", "signer", "sign", "--password"]) {
    if (!signScript.includes(expected)) {
      failures.push(`sign-tauri-updater-artifacts missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "TAURI_SIGNING_PRIVATE_KEY_PATH",
    "release:updater:prepare",
    "tauri",
    "build",
    "release:updater:sign",
    "generate-linux-release-checksums.mjs",
  ]) {
    if (!linuxUpdaterScript.includes(expected)) {
      failures.push(`release-linux-updater missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "latest.json",
    ".sig",
    "IMGCONVERT_PACKAGE_CONVERT_SMOKE",
    "APPIMAGE_EXTRACT_AND_RUN",
    "--no-run",
  ]) {
    if (!smokeScript.includes(expected)) {
      failures.push(`smoke-tauri-updater-release missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "--from-tag",
    "--to-tag",
    "--eligibility-only",
    "--require-gui",
    "Xvfb",
    "xdotool",
    "clickInstallButton",
    "waitForUpdatedArtifact",
    "IMGCONVERT_PACKAGE_CONVERT_SMOKE",
    "releases/latest/download/latest.json",
  ]) {
    if (!upgradeSmokeScript.includes(expected)) {
      failures.push(`smoke-tauri-in-app-updater missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "checkTauriUpdate",
    "downloadAndInstall",
    "relaunch",
    "checkForAppUpdate",
    "installAppUpdate",
  ]) {
    if (!stateTs.includes(expected) && !updateDialog.includes(expected)) {
      failures.push(`updater UI missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "workflow_dispatch:",
    "publish_release",
    "TAURI_UPDATER_PUBKEY",
    "TAURI_SIGNING_PRIVATE_KEY",
    "releases/latest/download/latest.json",
    "release:updater:verify",
    "IMGCONVERT_PACKAGE_CONVERT_SMOKE",
    "softprops/action-gh-release",
  ]) {
    if (!updaterWorkflow.includes(expected)) {
      failures.push(`release-updater.yml missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "workflow_dispatch:",
    "ubuntu-24.04",
    "xdotool",
    "xvfb",
    "smoke-tauri-in-app-updater.mjs",
  ]) {
    if (!upgradeSmokeWorkflow.includes(expected)) {
      failures.push(`updater-upgrade-smoke.yml missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "pnpm tauri signer generate --ci",
    "TAURI_UPDATER_PUBKEY",
    "TAURI_SIGNING_PRIVATE_KEY",
    "releases/latest/download/latest.json",
    "release:updater:verify",
    "release:updater:smoke",
    "release:updater:upgrade-smoke",
  ]) {
    if (!updaterDocs.includes(expected)) {
      failures.push(`docs/UPDATER.md missing marker: ${expected}`);
    }
  }
}

function checkFlatpakHeicExtensionGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  const extensionDir = path.join(repoRoot, "packaging", "flatpak", "extensions", "heic");
  const manifest = readText(path.join(extensionDir, "io.github.yeagoo.imgconvert.Codecs.Heic.yml"));
  const codecManifest = readText(path.join(extensionDir, "imgconvert-codec-heic.json"));
  const helper = readText(path.join(extensionDir, "imgconvert-heic-helper.sh"));
  const checkScript = readText(path.join(repoRoot, "scripts", "check-flatpak-heic-extension.mjs"));
  const smokeScript = readText(path.join(repoRoot, "scripts", "smoke-flatpak-heic-extension.mjs"));

  if (
    !packageScripts["release:flatpak:heic:verify"]?.includes("check-flatpak-heic-extension.mjs")
  ) {
    failures.push("package.json must expose release:flatpak:heic:verify");
  }
  if (!packageScripts["release:flatpak:heic:smoke"]?.includes("smoke-flatpak-heic-extension.mjs")) {
    failures.push("package.json must expose release:flatpak:heic:smoke");
  }
  if (
    !packageScripts["release:flatpak:heic:download-check"]?.includes(
      "smoke-flatpak-heic-extension.mjs --download-only",
    )
  ) {
    failures.push("package.json must expose release:flatpak:heic:download-check");
  }
  if (!packageScripts["release:flatpak:verify"]?.includes("check-flatpak-heic-extension.mjs")) {
    failures.push("release:flatpak:verify must include HEIC extension static guardrails");
  }
  for (const expected of [
    "build-extension: true",
    "libde265-1.1.1.tar.gz",
    "libheif-1.23.1.tar.gz",
    "- -DWITH_LIBDE265=ON",
    "- -DLIBDE265_INCLUDE_DIR=/app/extensions/codecs/Heic/include",
    "- -DLIBDE265_LIBRARY=/app/extensions/codecs/Heic/lib/libde265.so",
    "prepend-ld-library-path: /app/extensions/codecs/Heic/lib",
    "- /bin/dec265",
    "- /bin/heif-enc",
    "- -DWITH_X265=OFF",
    "- -DENABLE_ENCODER=OFF",
    "heif-dec --list-decoders | grep -i libde265",
    "share/licenses/io.github.yeagoo.imgconvert.Codecs.Heic",
  ]) {
    if (!manifest.includes(expected)) {
      failures.push(`Flatpak HEIC extension manifest missing marker: ${expected}`);
    }
  }
  for (const expected of [
    '"writable": []',
    '"command": "bin/imgconvert-heic-helper"',
    '"{metadata}"',
  ]) {
    if (!codecManifest.includes(expected)) {
      failures.push(`Flatpak HEIC codec manifest missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "set -eu",
    'helper_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    '"$helper_dir/heif-dec" --quiet "$input" "$output"',
    '{"version":1}',
  ]) {
    if (!helper.includes(expected)) {
      failures.push(`Flatpak HEIC helper wrapper missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "libde265-1.1.1.tar.gz",
    "libheif-1.23.1.tar.gz",
    "ENABLE_ENCODER=OFF",
    "WITH_X265=OFF",
  ]) {
    if (!checkScript.includes(expected)) {
      failures.push(`check-flatpak-heic-extension missing marker: ${expected}`);
    }
  }
  for (const expected of ["flatpak-builder", "--download-only", "--allow-missing-runtimes"]) {
    if (!smokeScript.includes(expected)) {
      failures.push(`smoke-flatpak-heic-extension missing marker: ${expected}`);
    }
  }
}

function checkFlathubReleaseGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  const mainMetainfo = readText(
    path.join(repoRoot, "packaging", "flatpak", "io.github.yeagoo.imgconvert.metainfo.xml"),
  );
  const heicMetainfo = readText(
    path.join(
      repoRoot,
      "packaging",
      "flatpak",
      "extensions",
      "heic",
      "io.github.yeagoo.imgconvert.Codecs.Heic.metainfo.xml",
    ),
  );
  const flatpakReadme = readText(path.join(repoRoot, "packaging", "flatpak", "README.md"));
  const metadataScript = readText(path.join(repoRoot, "scripts", "check-flathub-metadata.mjs"));
  const prScript = readText(path.join(repoRoot, "scripts", "prepare-flathub-pr.mjs"));
  const realSmokeScript = readText(
    path.join(repoRoot, "scripts", "smoke-flatpak-heic-runtime.mjs"),
  );
  const runtimeSmokeScript = readText(path.join(repoRoot, "scripts", "smoke-flatpak-runtime.mjs"));

  for (const [scriptName, marker] of [
    ["release:flathub:metadata", "check-flathub-metadata.mjs"],
    ["release:flathub:metadata:lint", "check-flathub-metadata.mjs --flathub-lint"],
    ["release:flathub:pr", "prepare-flathub-pr.mjs --kind=all"],
    ["release:flathub:main-pr", "prepare-flathub-pr.mjs --kind=main"],
    ["release:flathub:heic-pr", "prepare-flathub-pr.mjs --kind=heic"],
    ["release:flatpak:heic:real-smoke", "smoke-flatpak-heic-runtime.mjs"],
  ]) {
    if (!packageScripts[scriptName]?.includes(marker)) {
      failures.push(`package.json must expose ${scriptName}`);
    }
  }
  if (!packageScripts["release:flatpak:verify"]?.includes("check-flathub-metadata.mjs")) {
    failures.push("release:flatpak:verify must include Flathub metadata validation");
  }

  for (const expected of [
    '<developer id="io.github.yeagoo">',
    '<url type="homepage">https://github.com/web-casa/ImgConvert</url>',
    '<url type="vcs-browser">https://github.com/web-casa/ImgConvert</url>',
    '<url type="bugtracker">https://github.com/web-casa/ImgConvert/issues</url>',
    "<screenshots>",
    '<screenshot type="default">',
    "<caption>Batch image conversion queue and output settings</caption>",
  ]) {
    if (!mainMetainfo.includes(expected)) {
      failures.push(`main Flatpak MetaInfo missing marker: ${expected}`);
    }
  }
  if (mainMetainfo.includes("<developer_name>")) {
    failures.push("main Flatpak MetaInfo must not use deprecated developer_name");
  }
  for (const expected of [
    '<developer id="io.github.yeagoo">',
    '<url type="homepage">https://github.com/web-casa/ImgConvert</url>',
    '<url type="vcs-browser">https://github.com/web-casa/ImgConvert</url>',
    "<project_license>LGPL-3.0-or-later</project_license>",
  ]) {
    if (!heicMetainfo.includes(expected)) {
      failures.push(`HEIC extension MetaInfo missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "appstreamcli validate",
    "flatpak-builder-lint",
    "developer_name",
    "screenshots",
    "localScreenshotPath",
    "vcs-browser",
  ]) {
    if (!metadataScript.includes(expected)) {
      failures.push(`check-flathub-metadata missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "FLATHUB_SOURCE_URL",
    "FLATHUB_RELEASE_REF",
    "io.github.yeagoo.imgconvert.yml",
    "io.github.yeagoo.imgconvert.Codecs.Heic.yml",
    "raw.githubusercontent.com",
    "sha256File",
  ]) {
    if (!prScript.includes(expected)) {
      failures.push(`prepare-flathub-pr missing marker: ${expected}`);
    }
  }
  for (const expected of [
    "IMGCONVERT_FLATPAK_HEIC_SMOKE_INPUT",
    "cleanupSmokeInstalls",
    "cleanupSmokeRemotes",
    "--show-origin",
    "heif-enc",
    '"install"',
    "IMGCONVERT_PATH_CONVERT_SMOKE",
    "IMGCONVERT_DISABLE_EXTERNAL_CODECS=1",
    "IMGCONVERT_ALLOW_FLATPAK_CODEC_EXTENSIONS=1",
  ]) {
    if (!realSmokeScript.includes(expected)) {
      failures.push(`smoke-flatpak-heic-runtime missing marker: ${expected}`);
    }
  }
  if (!runtimeSmokeScript.includes("--repo=")) {
    failures.push("smoke-flatpak-runtime must support --repo for main+extension local smoke");
  }
  for (const expected of [
    "release:flathub:main-pr",
    "release:flathub:heic-pr",
    "release:flathub:metadata",
    "release:flatpak:heic:real-smoke",
    "flatpak-builder-lint",
  ]) {
    if (!flatpakReadme.includes(expected)) {
      failures.push(`Flatpak README must document ${expected}`);
    }
  }
}

function checkMacos() {
  requireBundleIcon(".icns", "macOS");
  checkMacosRuntimeGuardrails();
  const directSelected = options.channels.includes("direct");
  const storeSelected = options.channels.includes("store");
  if (directSelected && tauriConfig.bundle?.targets === undefined) {
    failures.push("macOS direct distribution needs bundle targets configured");
  }
  if (directSelected) {
    checkMacosDirectConfig();
  }
  if (storeSelected && !storeCodecGuardrailStaticFilesPresent()) {
    failures.push("macOS store channel requires build-time external codec disable guardrails");
  }
  if (storeSelected) {
    checkMacosStoreConfig();
  }
}

function checkMacosRuntimeGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  if (!packageScripts["bench:platform"]?.includes("benchmark-platform.mjs")) {
    failures.push("package.json must expose bench:platform for AVIF/WebP platform timing");
  }
  if (!packageScripts["bench:avif:macos"]?.includes("benchmark-macos-avif.mjs")) {
    failures.push("package.json must expose bench:avif:macos for Apple Silicon AVIF timing");
  }
  if (!packageScripts["release:macos:smoke"]?.includes("smoke-macos-runtime.mjs")) {
    failures.push(
      "package.json must expose release:macos:smoke for real-machine runtime acceptance",
    );
  }
  if (!packageScripts["release:macos"]?.includes("check-macos-bundle-artifacts.mjs")) {
    failures.push("package.json must expose release:macos with DMG artifact verification");
  }
  if (!packageScripts["release:macos:notarize"]?.includes("notarize-macos-dmg.mjs")) {
    failures.push("package.json must expose release:macos:notarize");
  }
  if (!packageScripts["release:macos:mas:prepare"]?.includes("prepare-macos-mas-release.mjs")) {
    failures.push("package.json must expose release:macos:mas:prepare");
  }
  if (
    !packageScripts["release:macos:mas"]?.includes("release:macos:mas:prepare") ||
    !packageScripts["release:macos:mas"]?.includes("check-macos-bundle-artifacts.mjs") ||
    !packageScripts["release:macos:mas"]?.includes("IMGCONVERT_DISABLE_EXTERNAL_CODECS=1")
  ) {
    failures.push(
      "package.json must expose release:macos:mas with store codec guardrail and app artifact verification",
    );
  }
  if (!packageScripts["release:macos:mas:pkg"]?.includes("package-macos-mas-pkg.mjs")) {
    failures.push("package.json must expose release:macos:mas:pkg");
  }
  for (const script of [
    "scripts/smoke-macos-runtime.mjs",
    "scripts/clean-macos-bundles.mjs",
    "scripts/check-macos-bundle-artifacts.mjs",
    "scripts/notarize-macos-dmg.mjs",
    "scripts/prepare-macos-mas-release.mjs",
    "scripts/package-macos-mas-pkg.mjs",
  ]) {
    if (!existsSync(path.join(repoRoot, script))) {
      failures.push(`${script} is required for macOS runtime/build smoke`);
    }
  }
  const macosWorkflow = readText(path.join(repoRoot, ".github", "workflows", "macos-smoke.yml"));
  for (const expected of ["Verify macOS runner architecture", "uname -m", "arm64"]) {
    if (!macosWorkflow.includes(expected)) {
      failures.push(`macOS Smoke workflow must verify ${expected}`);
    }
  }

  const cargoToml = readText(path.join(repoRoot, "src-tauri", "Cargo.toml"));
  const libRs = readText(path.join(repoRoot, "src-tauri", "src", "lib.rs"));
  const stateTs = readText(path.join(repoRoot, "src", "lib", "state.svelte.ts"));
  const capabilities = readText(path.join(repoRoot, "src-tauri", "capabilities", "default.json"));
  if (!cargoToml.includes("tauri-plugin-fs")) {
    failures.push("macOS scoped dialog persistence needs tauri-plugin-fs in Cargo.toml");
  }
  if (!cargoToml.includes("tauri-plugin-persisted-scope")) {
    failures.push("macOS MAS path persistence needs tauri-plugin-persisted-scope in Cargo.toml");
  }
  if (!libRs.includes("tauri_plugin_fs::init()")) {
    failures.push("Tauri builder must register fs plugin before scoped dialog persistence");
  }
  if (!libRs.includes("tauri_plugin_persisted_scope::init()")) {
    failures.push("Tauri builder must register persisted scope before macOS MAS release");
  }
  if (!stateTs.includes('fileAccessMode: platform === "macos" ? "scoped" : undefined')) {
    failures.push("macOS file dialog must request scoped file access");
  }
  if (!capabilities.includes('"fs:scope"')) {
    failures.push("Tauri capability must include fs:scope so dialog grants can be persisted");
  }

  const masPrepare = readText(path.join(repoRoot, "scripts", "prepare-macos-mas-release.mjs"));
  for (const expected of [
    "APPLE_TEAM_ID",
    "IMGCONVERT_MAS_PROVISION_PROFILE",
    "IMGCONVERT_MAS_PROVISION_PROFILE_BASE64",
    "com.apple.application-identifier",
    "com.apple.developer.team-identifier",
    "embedded.provisionprofile",
  ]) {
    if (!masPrepare.includes(expected)) {
      failures.push(`prepare-macos-mas-release.mjs must handle ${expected}`);
    }
  }

  const systemCodecs = readText(path.join(repoRoot, "src-tauri", "src", "macos_system_codecs.rs"));
  if (!systemCodecs.includes("ImageIO.framework")) {
    failures.push("macOS system codec bridge must use ImageIO.framework");
  }
  if (!systemCodecs.includes("system-imageio")) {
    failures.push("macOS ImageIO HEIC provider kind must stay system-imageio");
  }
  if (!systemCodecs.includes("writable: Vec::new()")) {
    failures.push(
      "macOS ImageIO HEIC provider must remain read-only until HEIC encoding is audited",
    );
  }
  if (!systemCodecs.includes("CGImageSourceCreateWithURL")) {
    failures.push(
      "macOS ImageIO HEIC bridge must use file URL decode instead of buffering full input",
    );
  }

  const security = readText(path.join(repoRoot, "src-tauri", "src", "macos_security.rs"));
  for (const expected of [
    "CFURLStartAccessingSecurityScopedResource",
    "CFURLStopAccessingSecurityScopedResource",
  ]) {
    if (!security.includes(expected)) {
      failures.push(`macOS security scope shim must call ${expected}`);
    }
  }

  const readme = readText(path.join(repoRoot, "packaging", "macos", "README.md"));
  for (const expected of [
    "ImageIO",
    "security-scoped",
    "notarytool",
    "bench:avif:macos",
    "release:macos:smoke",
    "release:macos",
  ]) {
    if (!readme.includes(expected)) {
      failures.push(`packaging/macos/README.md must document ${expected}`);
    }
  }
}

function checkWindows() {
  requireBundleIcon(".ico", "Windows");
  checkWindowsRuntimeGuardrails();
  const directSelected = options.channels.includes("direct");
  const storeSelected = options.channels.includes("store");
  if (directSelected) {
    checkWindowsDirectConfig();
  }
  if (storeSelected && !storeCodecGuardrailStaticFilesPresent()) {
    failures.push("Windows store channel requires build-time external codec disable guardrails");
  }
  if (storeSelected) {
    checkWindowsStoreDocs();
  }
}

function checkWindowsRuntimeGuardrails() {
  const packageScripts = packageJson.scripts ?? {};
  if (!packageScripts["release:windows:smoke"]?.includes("smoke-windows-runtime.mjs")) {
    failures.push("package.json must expose release:windows:smoke for Windows runtime acceptance");
  }
  if (!packageScripts["release:windows"]?.includes("check-windows-bundle-artifacts.mjs")) {
    failures.push("package.json must expose release:windows with installer artifact verification");
  }
  if (!packageScripts["release:windows:sign"]?.includes("sign-windows-installers.mjs")) {
    failures.push("package.json must expose release:windows:sign for Authenticode signing");
  }
  if (!packageScripts["release:windows:install-smoke"]?.includes("smoke-windows-installers.mjs")) {
    failures.push("package.json must expose release:windows:install-smoke for install/start smoke");
  }
  if (
    !packageScripts["release:windows:msix:prepare"]?.includes("prepare-windows-msix-release.mjs")
  ) {
    failures.push("package.json must expose release:windows:msix:prepare for Store manifest prep");
  }
  if (!packageScripts["release:windows:msix"]?.includes("pack-windows-msix.mjs")) {
    failures.push("package.json must expose release:windows:msix for Store MSIX packaging");
  }
  if (!packageScripts["release:windows:msix:pack"]?.includes("pack-windows-msix.mjs")) {
    failures.push("package.json must expose release:windows:msix:pack for Store MSIX packaging");
  }
  if (!packageScripts["release:windows:msix:smoke"]?.includes("smoke-windows-msix.mjs")) {
    failures.push("package.json must expose release:windows:msix:smoke for MSIX install smoke");
  }
  for (const script of [
    "scripts/smoke-windows-runtime.mjs",
    "scripts/clean-windows-bundles.mjs",
    "scripts/check-windows-bundle-artifacts.mjs",
    "scripts/sign-windows-installers.mjs",
    "scripts/smoke-windows-installers.mjs",
    "scripts/prepare-windows-msix-release.mjs",
    "scripts/pack-windows-msix.mjs",
    "scripts/smoke-windows-msix.mjs",
  ]) {
    if (!existsSync(path.join(repoRoot, script))) {
      failures.push(`${script} is required for Windows direct runtime/build smoke`);
    }
  }
  const windowsWorkflow = readText(
    path.join(repoRoot, ".github", "workflows", "windows-smoke.yml"),
  );
  for (const expected of ["sign_direct", "install_smoke", "WINDOWS_CERTIFICATE_BASE64"]) {
    if (!windowsWorkflow.includes(expected)) {
      failures.push(`Windows Smoke workflow must support ${expected}`);
    }
  }
  const windowsSystemCodecs = readText(
    path.join(repoRoot, "src-tauri", "src", "windows_system_codecs.rs"),
  );
  for (const expected of ["system-wic", "HEIF Image Extensions", "HEVC Video Extensions"]) {
    if (!windowsSystemCodecs.includes(expected)) {
      failures.push(`Windows WIC HEIC diagnostics must mention ${expected}`);
    }
  }
}

function checkStoreCodecGuardrail() {
  const buildRs = readText(path.join(repoRoot, "src-tauri", "build.rs"));
  const externalCodecs = readText(path.join(repoRoot, "src-tauri", "src", "external_codecs.rs"));

  if (!buildRs.includes("rerun-if-env-changed=IMGCONVERT_DISABLE_EXTERNAL_CODECS")) {
    failures.push("src-tauri/build.rs must rerun when IMGCONVERT_DISABLE_EXTERNAL_CODECS changes");
  }
  if (!externalCodecs.includes('option_env!("IMGCONVERT_DISABLE_EXTERNAL_CODECS")')) {
    failures.push(
      "external_codecs.rs must read IMGCONVERT_DISABLE_EXTERNAL_CODECS at compile time",
    );
  }
  if (options.requireStoreEnv && !truthy(process.env.IMGCONVERT_DISABLE_EXTERNAL_CODECS)) {
    failures.push(
      "store release builds must set IMGCONVERT_DISABLE_EXTERNAL_CODECS=1 so external codec/helper discovery is compiled off",
    );
  }
}

function checkMacosDirectConfig() {
  const configPath = path.join(srcTauriRoot, "tauri.macos.conf.json");
  const config = readJson(configPath);
  const macos = config.bundle?.macOS;
  if (!macos) {
    failures.push("src-tauri/tauri.macos.conf.json must define bundle.macOS");
    return;
  }
  if (macos.hardenedRuntime !== true) {
    failures.push("macOS direct config must enable hardenedRuntime");
  }
  if (macos.entitlements !== "entitlements.macos.direct.plist") {
    failures.push("macOS direct config must use entitlements.macos.direct.plist");
  }
  const entitlements = readEntitlements(macos.entitlements);
  if (!entitlements) {
    return;
  }
  if (entitlements.get("com.apple.security.app-sandbox") === true) {
    failures.push("macOS direct entitlements must not enable App Sandbox");
  }
  checkForbiddenMacosEntitlements(entitlements, "macOS direct entitlements");
}

function checkMacosStoreConfig() {
  const prepare = readText(path.join(repoRoot, "scripts", "prepare-macos-mas-release.mjs"));
  for (const expected of ["IMGCONVERT_DISABLE_UPDATER", 'capabilities: ["default"]']) {
    if (!prepare.includes(expected)) {
      failures.push(
        `prepare-macos-mas-release.mjs must enforce Store updater disable: ${expected}`,
      );
    }
  }
  const configPath = path.join(srcTauriRoot, "tauri.macos.mas.conf.json");
  const config = readJson(configPath);
  const macos = config.bundle?.macOS;
  if (!macos) {
    failures.push("src-tauri/tauri.macos.mas.conf.json must define bundle.macOS");
    return;
  }
  if (macos.hardenedRuntime !== true) {
    failures.push("macOS MAS config must enable hardenedRuntime");
  }
  if (macos.entitlements !== "entitlements.macos.mas.plist") {
    failures.push("macOS MAS config must use entitlements.macos.mas.plist");
  }
  if (macos.infoPlist !== "Info.macos.mas.plist") {
    failures.push("macOS MAS config must merge Info.macos.mas.plist");
  }
  const infoPlist = readText(path.join(srcTauriRoot, "Info.macos.mas.plist"));
  if (!infoPlist.includes("ITSAppUsesNonExemptEncryption") || !infoPlist.includes("<false/>")) {
    failures.push(
      "Info.macos.mas.plist must declare no non-exempt encryption for App Store review",
    );
  }
  const entitlements = readEntitlements(macos.entitlements);
  if (!entitlements) {
    return;
  }
  requireEntitlement(entitlements, "com.apple.security.app-sandbox", true, "macOS MAS");
  requireEntitlement(
    entitlements,
    "com.apple.security.files.user-selected.read-write",
    true,
    "macOS MAS",
  );
  requireEntitlement(
    entitlements,
    "com.apple.security.files.bookmarks.app-scope",
    true,
    "macOS MAS",
  );
  checkForbiddenMacosEntitlements(entitlements, "macOS MAS entitlements");
}

function checkWindowsDirectConfig() {
  const configPath = path.join(srcTauriRoot, "tauri.windows.conf.json");
  const config = readJson(configPath);
  const windows = config.bundle?.windows;
  if (!windows) {
    failures.push("src-tauri/tauri.windows.conf.json must define bundle.windows");
    return;
  }
  if (windows.allowDowngrades !== false) {
    failures.push("Windows direct config must set allowDowngrades=false");
  }
  if ((windows.digestAlgorithm ?? "").toLowerCase() !== "sha256") {
    failures.push("Windows direct config must set digestAlgorithm=sha256");
  }

  const webviewMode = windows.webviewInstallMode;
  if (!webviewMode || typeof webviewMode !== "object") {
    failures.push("Windows direct config must set an explicit webviewInstallMode object");
  } else {
    if (webviewMode.type !== "embedBootstrapper") {
      failures.push("Windows direct config must use WebView2 embedBootstrapper");
    }
    if (webviewMode.silent !== true) {
      failures.push("Windows direct WebView2 bootstrapper must run silent");
    }
  }

  if (!/^\d+\.\d+\.\d+\.\d+$/.test(windows.minimumWebview2Version ?? "")) {
    failures.push("Windows direct config must set a four-part minimumWebview2Version");
  }
  if (!isUuid(windows.wix?.upgradeCode)) {
    failures.push("Windows direct WiX config must pin a stable upgradeCode UUID");
  }
  if (windows.nsis?.installMode !== "currentUser") {
    failures.push("Windows direct NSIS config must default to currentUser installMode");
  }
}

function checkWindowsStoreDocs() {
  const readme = readText(path.join(repoRoot, "packaging", "windows", "README.md"));
  if (!readme) {
    failures.push("Windows store channel requires packaging/windows/README.md");
    return;
  }
  for (const expected of [
    "MSIX",
    "runFullTrust",
    "Partner Center",
    "IMGCONVERT_DISABLE_EXTERNAL_CODECS=1",
    "IMGCONVERT_DISABLE_UPDATER=1",
    "release:windows:store:check",
    "release:windows:msix:prepare",
    "release:windows:msix",
    "release:windows:msix:smoke",
  ]) {
    if (!readme.includes(expected)) {
      failures.push(`packaging/windows/README.md must document ${expected}`);
    }
  }
  const msixPrepare = readText(path.join(repoRoot, "scripts", "prepare-windows-msix-release.mjs"));
  for (const expected of ["IMGCONVERT_DISABLE_UPDATER", 'capabilities: ["default"]']) {
    if (!msixPrepare.includes(expected)) {
      failures.push(
        `prepare-windows-msix-release.mjs must enforce Store updater disable: ${expected}`,
      );
    }
  }
  const windowsWorkflow = readText(
    path.join(repoRoot, ".github", "workflows", "windows-smoke.yml"),
  );
  if (!windowsWorkflow.includes('IMGCONVERT_DISABLE_UPDATER: "1"')) {
    failures.push("windows-smoke.yml MSIX job must set IMGCONVERT_DISABLE_UPDATER=1");
  }
  const msixTemplate = readText(
    path.join(repoRoot, "packaging", "windows", "msix", "AppxManifest.xml.template"),
  );
  for (const expected of ["runFullTrust", "Windows.FullTrustApplication", "desktop:Extension"]) {
    if (!msixTemplate.includes(expected)) {
      failures.push(`MSIX manifest template must include ${expected}`);
    }
  }
}

function storeCodecGuardrailStaticFilesPresent() {
  const buildRs = readText(path.join(repoRoot, "src-tauri", "build.rs"));
  const externalCodecs = readText(path.join(repoRoot, "src-tauri", "src", "external_codecs.rs"));
  return (
    buildRs.includes("rerun-if-env-changed=IMGCONVERT_DISABLE_EXTERNAL_CODECS") &&
    externalCodecs.includes('option_env!("IMGCONVERT_DISABLE_EXTERNAL_CODECS")')
  );
}

function requireBundleIcon(extension, platform) {
  const icons = tauriConfig.bundle?.icon ?? [];
  const icon = icons.find((item) => item.endsWith(extension));
  if (!icon) {
    failures.push(`tauri.conf.json bundle.icon must include a ${platform} ${extension} icon`);
    return;
  }
  if (!existsSync(path.resolve(repoRoot, "src-tauri", icon))) {
    failures.push(`${platform} icon does not exist: ${icon}`);
  }
}

function readEntitlements(fileName) {
  if (!fileName) {
    failures.push("macOS entitlements path is required");
    return null;
  }
  if (path.isAbsolute(fileName) || fileName.includes("..")) {
    failures.push(`macOS entitlements path must be relative to src-tauri: ${fileName}`);
    return null;
  }
  const file = path.join(srcTauriRoot, fileName);
  const text = readText(file);
  if (!text) {
    failures.push(`macOS entitlements file does not exist or is empty: ${fileName}`);
    return null;
  }
  if (!text.includes("<plist") || !text.includes("<dict>")) {
    failures.push(`macOS entitlements file must be a plist dict: ${fileName}`);
    return null;
  }
  return parseBooleanPlist(text);
}

function parseBooleanPlist(text) {
  const values = new Map();
  const pattern = /<key>([^<]+)<\/key>\s*<(true|false)\/>/g;
  for (const match of text.matchAll(pattern)) {
    values.set(match[1], match[2] === "true");
  }
  return values;
}

function requireEntitlement(values, key, expected, label) {
  if (values.get(key) !== expected) {
    failures.push(`${label} entitlements must set ${key}=${expected}`);
  }
}

function checkForbiddenMacosEntitlements(values, label) {
  for (const key of [
    "com.apple.security.network.server",
    "com.apple.security.files.all",
    "com.apple.security.temporary-exception.files.absolute-path.read-only",
    "com.apple.security.temporary-exception.files.absolute-path.read-write",
    "com.apple.security.temporary-exception.mach-lookup.global-name",
  ]) {
    if (values.has(key)) {
      failures.push(`${label} must not include broad temporary entitlement ${key}`);
    }
  }
}

function splitOption(value, allowed) {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const item of items) {
    if (!allowed.includes(item)) {
      fail(`unsupported option value: ${item}`);
    }
  }
  if (items.length === 0) {
    fail("option value must not be empty");
  }
  return [...new Set(items)];
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`failed to read ${path.relative(repoRoot, file)}: ${error.message}`);
  }
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(value ?? "");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? "");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
