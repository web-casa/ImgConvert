// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(projectRoot, "..");
const extensionPackage = await readJson(join(projectRoot, "package.json"));
const version = extensionPackage.version;
const assetRoot = join(projectRoot, "store", "assets", `v${version}`);
const candidateRoot = join(projectRoot, ".output", "store-candidate", `v${version}`);
const failures = [];

const expectedDescriptions = {
  en: "Convert images locally in your browser, with batch processing, previews, and adjustable quality.",
  zh_CN: "在浏览器本地转换图片，支持批量处理、结果预览和质量调整。",
};
const expectedAssets = new Map([
  ["shared/chrome-store-icon-128.png", [128, 128]],
  ["shared/edge-store-logo-300.png", [300, 300]],
  ["shared/small-promo-440x280.png", [440, 280]],
  ["shared/marquee-promo-1400x560.png", [1400, 560]],
  ...["en-US", "zh-CN"].flatMap((locale) =>
    [
      "01-local-batch-converted.png",
      "02-output-controls.png",
      "03-verified-preview.png",
      "04-local-first-overview.png",
      "05-dark-workbench.png",
    ].map((name) => [`${locale}/${name}`, [1280, 800]]),
  ),
]);

const chromeDraft = await readText(join(repositoryRoot, "CHROMEWEBSTORE.md"));
const edgeDraft = await readText(join(projectRoot, "store", "EDGE_ADDONS.md"));
const reviewerNotesEnglish = await readText(join(projectRoot, "store", "reviewer-notes.en-US.txt"));
const reviewerNotesChinese = await readText(join(projectRoot, "store", "reviewer-notes.zh-CN.txt"));
const privacySources = [
  ["PRIVACY.en.md", await readText(join(repositoryRoot, "PRIVACY.en.md"))],
  ["PRIVACY.md", await readText(join(repositoryRoot, "PRIVACY.md"))],
  ["pages/privacy/index.html", await readText(join(repositoryRoot, "pages/privacy/index.html"))],
  ["website/src/lib/legal.ts", await readText(join(repositoryRoot, "website/src/lib/legal.ts"))],
];
const evidenceDocumentPaths = [
  "CHROMEWEBSTORE.md",
  "PRIVACY.en.md",
  "PRIVACY.md",
  "browser-extension/store/EDGE_ADDONS.md",
  "browser-extension/store/reviewer-notes.en-US.txt",
  "browser-extension/store/reviewer-notes.zh-CN.txt",
  "pages/privacy/index.html",
  "website/src/lib/legal.ts",
];

for (const [label, text] of [
  ["CHROMEWEBSTORE.md", chromeDraft],
  ["EDGE_ADDONS.md", edgeDraft],
  ["reviewer-notes.en-US.txt", reviewerNotesEnglish],
  ["reviewer-notes.zh-CN.txt", reviewerNotesChinese],
]) {
  check(
    !/\b(?:TODO|TBD)\b|\[(?:REQUIRED|RECOMMENDED)\]/iu.test(text),
    `${label} has placeholder copy`,
  );
}
for (const [label, notes] of [
  ["English", reviewerNotesEnglish],
  ["Chinese", reviewerNotesChinese],
]) {
  check(
    notes.trim().length > 0 && notes.length < 2000,
    `${label} certification notes must contain fewer than 2,000 characters`,
  );
}
check(chromeDraft.includes("DO NOT UPLOAD OR SUBMIT"), "Chrome draft must remain local-only");
check(edgeDraft.includes("DO NOT UPLOAD OR PUBLISH"), "Edge draft must remain local-only");
check(
  chromeDraft.includes("account-owner confirmation required"),
  "Chrome publisher identity must remain unconfirmed",
);
check(
  edgeDraft.includes("account owner must confirm"),
  "Edge publisher identity must remain unconfirmed",
);
check(
  /optional `https:\/\/\*\/\*`/iu.test(chromeDraft),
  "Chrome draft must justify HTTPS-only optional access",
);
check(
  !chromeDraft.includes("optional `http://*/*`"),
  "Chrome draft must not justify optional HTTP access",
);
check(
  edgeDraft.includes("optional `https://*/*`"),
  "Edge draft must justify HTTPS-only optional access",
);
check(
  chromeDraft.includes(expectedDescriptions.en),
  "Chrome draft must contain the exact English manifest description",
);
check(
  chromeDraft.includes(expectedDescriptions.zh_CN),
  "Chrome draft must contain the exact Chinese manifest description",
);
check(
  edgeDraft.includes(expectedDescriptions.en),
  "Edge draft must contain the exact English manifest description",
);
check(
  edgeDraft.includes(expectedDescriptions.zh_CN),
  "Edge draft must contain the exact Chinese manifest description",
);
check(
  [...expectedDescriptions.en].length <= 132,
  "English manifest description exceeds 132 characters",
);
check(
  [...expectedDescriptions.zh_CN].length <= 132,
  "Chinese manifest description exceeds 132 characters",
);

for (const [locale, expectedDescription] of Object.entries(expectedDescriptions)) {
  for (const browser of ["chrome", "edge"]) {
    const messages = await readJson(
      join(projectRoot, ".output", `${browser}-mv3`, "_locales", locale, "messages.json"),
    );
    check(
      messages.extensionDescription?.message === expectedDescription,
      `${browser} ${locale} manifest description is stale`,
    );
  }
}

const englishDetail = fencedBlockAfter(chromeDraft, "### English (`en`)", "Detailed description:");
const chineseDetail = fencedBlockAfter(
  chromeDraft,
  "### Simplified Chinese (`zh_CN`)",
  "Detailed description:",
);
for (const [label, detail] of [
  ["English", englishDetail],
  ["Simplified Chinese", chineseDetail],
]) {
  check(
    detail.length >= 250,
    `${label} detailed description must contain at least 250 characters for Edge`,
  );
  check(
    detail.length <= 10_000,
    `${label} detailed description exceeds Edge's 10,000-character limit`,
  );
}
check(countDelimitedTerms(edgeDraft, "Search terms:") <= 7, "English Edge search terms exceed 7");
check(countDelimitedTerms(edgeDraft, "搜索词：") <= 7, "Chinese Edge search terms exceed 7");

const provenancePath = join(assetRoot, "provenance.json");
const provenance = await readJson(provenancePath);
check(provenance.assetSchemaVersion === 2, "Asset provenance schema is unsupported");
check(provenance.productVersion === version, "Asset provenance product version is stale");
check(provenance.build?.version === version, "Asset provenance build version is stale");
check(provenance.build?.target === "chrome-mv3", "Asset provenance must identify chrome-mv3");
check(
  typeof provenance.browser === "string" && provenance.browser.length > 0,
  "Asset provenance must identify the capture browser",
);
check(
  provenance.build?.sha256 ===
    (await directoryFingerprint(join(projectRoot, ".output", "chrome-mv3"))),
  "Asset provenance does not match the current Chrome build",
);

const actualAssetPaths = (await filesUnder(assetRoot))
  .map((path) => relative(assetRoot, path).split(sep).join("/"))
  .filter((path) => path !== "provenance.json")
  .sort();
check(
  JSON.stringify(actualAssetPaths) === JSON.stringify([...expectedAssets.keys()].sort()),
  "Store asset directory must contain exactly the expected screenshots and graphics",
);
const provenanceAssets = new Map(
  (Array.isArray(provenance.assets) ? provenance.assets : []).map((entry) => [entry.path, entry]),
);
check(
  provenanceAssets.size === expectedAssets.size,
  "Asset provenance must cover every expected asset exactly once",
);
for (const [assetPath, [expectedWidth, expectedHeight]] of expectedAssets) {
  const absolutePath = join(assetRoot, assetPath);
  const bytes = await readFileSafe(absolutePath);
  const dimensions = bytes ? pngDimensions(bytes) : undefined;
  check(
    dimensions?.width === expectedWidth && dimensions.height === expectedHeight,
    `${assetPath} must be an exact ${expectedWidth}×${expectedHeight} PNG`,
  );
  const recorded = provenanceAssets.get(assetPath);
  check(recorded?.bytes === bytes?.byteLength, `${assetPath} provenance byte count is stale`);
  check(recorded?.sha256 === hashBytes(bytes), `${assetPath} provenance hash is stale`);
}

const storeIcon = await readFileSafe(join(assetRoot, "shared", "chrome-store-icon-128.png"));
for (const iconPath of [
  join(projectRoot, "public", "icon", "128.png"),
  join(projectRoot, ".output", "chrome-mv3", "icon", "128.png"),
  join(projectRoot, ".output", "edge-mv3", "icon", "128.png"),
]) {
  const icon = await readFileSafe(iconPath);
  check(
    icon?.equals(storeIcon),
    `${relative(repositoryRoot, iconPath)} must match the reviewed store icon`,
  );
}

for (const [sourcePath, expectedName, expectedPurpose] of [
  ["src-tauri/icons/icon.png", "app-icon.png", "graphics"],
  ["website/public/images/generated/local-atelier.png", "studio-photo.png", "screenshots"],
  ["website/public/images/generated/private-vault.webp", "private-workspace.webp", "screenshots"],
]) {
  const record = provenance.sources?.find(
    (entry) =>
      entry.path === sourcePath && entry.name === expectedName && entry.purpose === expectedPurpose,
  );
  check(Boolean(record), `Asset provenance is missing controlled source ${sourcePath}`);
  if (record) {
    check(
      record.sha256 === (await sha256File(join(repositoryRoot, sourcePath))),
      `Controlled source hash changed: ${sourcePath}`,
    );
  }
}

const limitedUseEnglish =
  "ImgConvert's use of information received from browser extension APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.";
const limitedUseChinese =
  "ImgConvert 对从浏览器扩展 API 获得的信息的使用遵守 Chrome Web Store 用户数据政策，包括 Limited Use 要求";
for (const [path, text] of privacySources) {
  const normalized = normalizeWhitespace(text);
  check(
    /Chrome (?:and|与) Edge browser extensions|Chrome 与 Edge 浏览器扩展/iu.test(normalized),
    `${path} is missing the browser-extension section`,
  );
  check(normalized.includes("32 MB"), `${path} is missing the HTTPS response limit`);
  check(/two minutes|两分钟/iu.test(normalized), `${path} is missing the handoff retention limit`);
  check(
    normalized.includes("Web history") && normalized.includes("Website content"),
    `${path} is missing the conservative store data categories`,
  );
}
for (const [path, text] of privacySources.filter(([path]) => path !== "PRIVACY.md")) {
  const normalized = normalizeWhitespace(text);
  check(
    normalized.includes(limitedUseEnglish),
    `${path} is missing the exact English Limited Use statement`,
  );
  for (const required of [
    "temporary lease containing no image URL",
    "panel closure",
    "background recovery",
    "access that predates the import",
  ]) {
    check(
      normalized.includes(required),
      `${path} is missing permission lifecycle copy: ${required}`,
    );
  }
}
for (const [path, text] of privacySources.filter(([path]) => path !== "PRIVACY.en.md")) {
  const normalized = normalizeWhitespace(text);
  check(
    normalized.includes(limitedUseChinese),
    `${path} is missing the Chinese Limited Use statement`,
  );
  for (const required of [
    "不含图片 URL 的临时权限租约",
    "侧栏关闭",
    "后台恢复",
    "导入前已经存在的访问权不会被移除",
  ]) {
    check(normalized.includes(required), `${path} 缺少权限生命周期说明：${required}`);
  }
}

for (const browser of ["chrome", "edge"]) {
  const manifest = await readJson(join(projectRoot, ".output", `${browser}-mv3`, "manifest.json"));
  check(manifest.manifest_version === 3, `${browser} candidate must use Manifest V3`);
  check(manifest.version === version, `${browser} candidate manifest version is stale`);
  check(
    JSON.stringify(manifest.permissions) ===
      JSON.stringify(["storage", "contextMenus", "sidePanel"]),
    `${browser} candidate permissions changed`,
  );
  check(
    manifest.side_panel?.default_path === "converter.html?surface=side-panel",
    `${browser} candidate side-panel path changed`,
  );
  check(
    JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(["https://*/*"]),
    `${browser} candidate optional host permissions must be HTTPS-only`,
  );
}

const checksumText = await readText(join(candidateRoot, "SHA256SUMS"));
const checksumEntries = new Map(
  checksumText
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64}) {2}([^/]+)$/u);
      if (!match) return [line, undefined];
      return [match[2], match[1]];
    }),
);
const expectedPackageNames = ["chrome", "edge"].map(
  (browser) => `imgconvert-${browser}-mv3-${version}.zip`,
);
check(checksumEntries.size === 2, "SHA256SUMS must contain exactly the Chrome and Edge ZIPs");
for (const name of expectedPackageNames) {
  const sourcePath = join(projectRoot, ".output", name);
  const candidatePath = join(candidateRoot, name);
  check(
    checksumEntries.get(name) === (await sha256File(candidatePath)),
    `${name} checksum is missing or stale`,
  );
  check(
    (await sha256File(sourcePath)) === (await sha256File(candidatePath)),
    `${name} no longer matches the current validated vendor ZIP`,
  );
}

const manifestComparison = await readJson(join(candidateRoot, "manifest-diff.json"));
check(manifestComparison.equal === true, "Candidate manifests must be semantically equal");
check(
  Array.isArray(manifestComparison.differences) && manifestComparison.differences.length === 0,
  "Candidate manifest comparison must contain no differences",
);
for (const [browser, field] of [
  ["chrome", "chromeSha256"],
  ["edge", "edgeSha256"],
]) {
  check(
    manifestComparison[field] ===
      (await sha256File(join(projectRoot, ".output", `${browser}-mv3`, "manifest.json"))),
    `${browser} manifest comparison hash is stale`,
  );
}
const releaseEvidence = await readJson(join(candidateRoot, "release-evidence.json"));
check(releaseEvidence.schemaVersion === 1, "Release evidence schema is unsupported");
check(releaseEvidence.version === version, "Release evidence version is stale");
check(
  releaseEvidence.state === "local-draft-only",
  "Release evidence must not claim publication readiness",
);
check(releaseEvidence.packages?.length === 2, "Release evidence must cover both vendor ZIPs");
check(
  releaseEvidence.externalGates?.length === 5,
  "Release evidence must preserve all external gates",
);
for (const name of expectedPackageNames) {
  const recorded = releaseEvidence.packages?.find((entry) => entry.path === name);
  check(
    recorded?.sha256 === (await sha256File(join(candidateRoot, name))),
    `${name} release evidence hash is stale`,
  );
}
check(
  releaseEvidence.assets?.sha256 === (await sha256File(provenancePath)),
  "Release evidence asset-provenance hash is stale",
);
check(
  JSON.stringify(releaseEvidence.manifestComparison) === JSON.stringify(manifestComparison),
  "Release evidence manifest comparison is stale",
);
check(
  JSON.stringify((releaseEvidence.documents ?? []).map((entry) => entry.path).sort()) ===
    JSON.stringify([...evidenceDocumentPaths].sort()),
  "Release evidence must cover exactly the reviewed source documents",
);
for (const documentPath of evidenceDocumentPaths) {
  const recorded = releaseEvidence.documents?.find((entry) => entry.path === documentPath);
  check(
    recorded?.sha256 === (await sha256File(join(repositoryRoot, documentPath))),
    `Release evidence document hash is stale: ${documentPath}`,
  );
}
for (const browser of ["chrome", "edge"]) {
  const reportPath = join(projectRoot, ".output", "reports", `${browser}-bundle.json`);
  const report = await readJson(reportPath);
  const recorded = releaseEvidence.reports?.find((entry) => entry.browser === browser);
  check(report.passed === true, `${browser} bundle report must pass`);
  check(
    recorded?.sha256 === (await sha256File(reportPath)),
    `${browser} bundle report evidence is stale`,
  );
  check(
    (await readText(join(candidateRoot, `${browser}-files.txt`))) === formatInventory(report.files),
    `${browser} candidate inventory is stale`,
  );
}
check(
  (await sha256File(join(candidateRoot, "THIRD_PARTY_LICENSES.md"))) ===
    (await sha256File(join(repositoryRoot, "THIRD_PARTY_LICENSES.md"))),
  "Candidate third-party license notice is stale",
);

if (failures.length > 0) {
  throw new Error(`Store draft validation failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  `Store draft passed: ${expectedAssets.size} reviewed assets, 2 HTTPS-only vendor packages, synchronized privacy copy, and local-only release evidence`,
);

function check(condition, message) {
  if (!condition) failures.push(message);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function fencedBlockAfter(text, sectionHeading, fieldLabel) {
  const sectionIndex = text.indexOf(sectionHeading);
  const fieldIndex = text.indexOf(fieldLabel, sectionIndex);
  const fenceStart = text.indexOf("```text", fieldIndex);
  const contentStart = text.indexOf("\n", fenceStart) + 1;
  const fenceEnd = text.indexOf("\n```", contentStart);
  if (sectionIndex < 0 || fieldIndex < 0 || fenceStart < 0 || contentStart === 0 || fenceEnd < 0) {
    failures.push(`Could not parse ${fieldLabel} after ${sectionHeading}`);
    return "";
  }
  return text.slice(contentStart, fenceEnd).trim();
}

function countDelimitedTerms(text, label) {
  const start = text.indexOf(label);
  const end = text.indexOf("\n\n", start);
  if (start < 0 || end < 0) {
    failures.push(`Could not parse ${label}`);
    return Number.POSITIVE_INFINITY;
  }
  return text
    .slice(start + label.length, end)
    .split(/[;；]/u)
    .map((term) => term.trim())
    .filter(Boolean).length;
}

function formatInventory(entries) {
  if (!Array.isArray(entries)) return "";
  return `# SHA256  Bytes  Path\n${entries.map((entry) => `${entry.sha256}  ${entry.bytes}  ${entry.path}`).join("\n")}\n`;
}

function pngDimensions(bytes) {
  if (!bytes || bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    return undefined;
  }
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
}

async function filesUnder(directory) {
  const result = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await filesUnder(path)));
      else if (entry.isFile()) result.push(path);
    }
  } catch (error) {
    failures.push(`Cannot read directory ${relative(repositoryRoot, directory)}: ${error.message}`);
  }
  return result;
}

async function directoryFingerprint(directory) {
  const digest = createHash("sha256");
  const files = (await filesUnder(directory)).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  for (const path of files) {
    digest.update(`${relative(directory, path).split(sep).join("/")}\0${await sha256File(path)}\n`);
  }
  return digest.digest("hex");
}

function hashBytes(bytes) {
  return bytes ? createHash("sha256").update(bytes).digest("hex") : undefined;
}

async function readFileSafe(path) {
  try {
    return await readFile(path);
  } catch (error) {
    failures.push(`Cannot read ${relative(repositoryRoot, path)}: ${error.message}`);
    return undefined;
  }
}

async function readJson(path) {
  const text = await readText(path);
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`Invalid JSON in ${relative(repositoryRoot, path)}: ${error.message}`);
    return {};
  }
}

async function readText(path) {
  const bytes = await readFileSafe(path);
  return bytes?.toString("utf8") ?? "";
}

async function sha256File(path) {
  const bytes = await readFileSafe(path);
  return hashBytes(bytes);
}
