// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(projectRoot, "..");
const outputRoot = join(projectRoot, ".output");
const extensionPackage = await readJson(join(projectRoot, "package.json"));
const version = extensionPackage.version;
const candidateRoot = join(outputRoot, "store-candidate", `v${version}`);
const assetRoot = join(projectRoot, "store", "assets", `v${version}`);

if (!candidateRoot.startsWith(`${outputRoot}${sep}`)) {
  throw new Error("Refusing to replace a candidate directory outside browser-extension/.output");
}

const vendorEvidence = {};
for (const browser of ["chrome", "edge"]) {
  const buildRoot = join(outputRoot, `${browser}-mv3`);
  const reportPath = join(outputRoot, "reports", `${browser}-bundle.json`);
  const report = await readJson(reportPath);
  const manifestPath = join(buildRoot, "manifest.json");
  const manifest = await readJson(manifestPath);
  const currentInventory = await inventory(buildRoot);

  if (!report.passed || report.browser !== browser || report.manifest?.version !== version) {
    throw new Error(`${browser} bundle report is missing, stale, or failed`);
  }
  if (JSON.stringify(currentInventory) !== JSON.stringify(report.files)) {
    throw new Error(`${browser} bundle report does not match the current unpacked build`);
  }
  if (manifest.version !== version) {
    throw new Error(`${browser} manifest version does not match ${version}`);
  }

  vendorEvidence[browser] = {
    buildRoot,
    inventory: currentInventory,
    manifest,
    manifestPath,
    reportPath,
    sourceArchivePath: join(outputRoot, `imgconvert-${browser}-mv3-${version}.zip`),
  };
}

const provenancePath = join(assetRoot, "provenance.json");
const provenance = await readJson(provenancePath);
if (provenance.productVersion !== version || provenance.build?.version !== version) {
  throw new Error("Store asset provenance is not for the current product version");
}

await rm(candidateRoot, { force: true, recursive: true });
await mkdir(candidateRoot, { recursive: true });

const packages = [];
for (const browser of ["chrome", "edge"]) {
  const sourcePath = vendorEvidence[browser].sourceArchivePath;
  const destinationName = `imgconvert-${browser}-mv3-${version}.zip`;
  const destinationPath = join(candidateRoot, destinationName);
  await assertNonEmpty(sourcePath);
  await copyFile(sourcePath, destinationPath);
  packages.push({
    browser,
    bytes: (await stat(destinationPath)).size,
    path: destinationName,
    sha256: await sha256File(destinationPath),
  });
  await writeFile(
    join(candidateRoot, `${browser}-files.txt`),
    formatInventory(vendorEvidence[browser].inventory),
    "utf8",
  );
}

await writeFile(
  join(candidateRoot, "SHA256SUMS"),
  `${packages.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`,
  "utf8",
);

const manifestDifferences = diffJson(vendorEvidence.chrome.manifest, vendorEvidence.edge.manifest);
const manifestComparison = {
  chromeSha256: await sha256File(vendorEvidence.chrome.manifestPath),
  differences: manifestDifferences,
  edgeSha256: await sha256File(vendorEvidence.edge.manifestPath),
  equal: manifestDifferences.length === 0,
  schemaVersion: 1,
};
await writeFile(
  join(candidateRoot, "manifest-diff.json"),
  `${JSON.stringify(manifestComparison, null, 2)}\n`,
  "utf8",
);
if (!manifestComparison.equal) {
  throw new Error("Chrome and Edge manifests diverged; inspect manifest-diff.json");
}

const thirdPartySource = join(repositoryRoot, "THIRD_PARTY_LICENSES.md");
const thirdPartyDestination = join(candidateRoot, "THIRD_PARTY_LICENSES.md");
await assertNonEmpty(thirdPartySource);
await copyFile(thirdPartySource, thirdPartyDestination);

const documentPaths = [
  "CHROMEWEBSTORE.md",
  "PRIVACY.en.md",
  "PRIVACY.md",
  "browser-extension/store/EDGE_ADDONS.md",
  "browser-extension/store/reviewer-notes.en-US.txt",
  "browser-extension/store/reviewer-notes.zh-CN.txt",
  "pages/privacy/index.html",
  "website/src/lib/legal.ts",
];
const documents = await Promise.all(
  documentPaths.map(async (path) => ({
    path,
    sha256: await sha256File(join(repositoryRoot, path)),
  })),
);
const reports = await Promise.all(
  ["chrome", "edge"].map(async (browser) => ({
    browser,
    path: relative(repositoryRoot, vendorEvidence[browser].reportPath).split(sep).join("/"),
    sha256: await sha256File(vendorEvidence[browser].reportPath),
  })),
);

const releaseEvidence = {
  assets: {
    path: relative(repositoryRoot, provenancePath).split(sep).join("/"),
    sha256: await sha256File(provenancePath),
  },
  documents,
  externalGates: [
    "Confirm the publisher identity and monitored contact email in each store account.",
    "Deploy and re-open both updated privacy URLs over HTTPS.",
    "Repeat the frozen Chrome and Edge vendor smoke after the HTTPS-only permission change.",
    "Complete the current-lockfile production dependency audit with canonical npm and independent OSV evidence.",
    "Obtain explicit authorization before creating a listing, uploading, submitting, or publishing.",
  ],
  generatedAt: new Date().toISOString(),
  licenseNotice: {
    path: "THIRD_PARTY_LICENSES.md",
    sha256: await sha256File(thirdPartyDestination),
  },
  manifestComparison,
  packages,
  reports,
  schemaVersion: 1,
  state: "local-draft-only",
  version,
};
await writeFile(
  join(candidateRoot, "release-evidence.json"),
  `${JSON.stringify(releaseEvidence, null, 2)}\n`,
  "utf8",
);

console.log(
  `Created local-only store candidate in ${relative(repositoryRoot, candidateRoot)} (${packages.map((entry) => `${entry.browser}: ${entry.bytes} bytes`).join(", ")})`,
);

async function inventory(directory) {
  const files = await filesUnder(directory);
  return await Promise.all(
    files
      .sort((left, right) => left.localeCompare(right, "en"))
      .map(async (path) => {
        const contents = await readFile(path);
        return {
          bytes: contents.byteLength,
          path: relative(directory, path).split(sep).join("/"),
          sha256: createHash("sha256").update(contents).digest("hex"),
        };
      }),
  );
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function formatInventory(entries) {
  return `# SHA256  Bytes  Path\n${entries.map((entry) => `${entry.sha256}  ${entry.bytes}  ${entry.path}`).join("\n")}\n`;
}

function diffJson(left, right, currentPath = "$") {
  if (Object.is(left, right)) return [];
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return [{ chrome: left, edge: right, path: currentPath }];
  }
  if (Array.isArray(left)) {
    const differences = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      differences.push(...diffJson(left[index], right[index], `${currentPath}[${index}]`));
    }
    return differences;
  }
  const differences = [];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    differences.push(...diffJson(left[key], right[key], `${currentPath}.${key}`));
  }
  return differences;
}

async function assertNonEmpty(path) {
  if ((await stat(path)).size === 0) throw new Error(`Required file is empty: ${path}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
