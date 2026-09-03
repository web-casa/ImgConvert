import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const inventory = JSON.parse(
  await readFile(new URL("../licenses/native-codecs.json", import.meta.url), "utf8"),
);
const expectedPackages = [
  { name: "@jsquash/avif", version: "2.1.1" },
  { name: "@jsquash/jpeg", version: "1.6.0" },
  { name: "@jsquash/png", version: "3.1.1" },
  { name: "@jsquash/webp", version: "1.5.0" },
  { name: "wasm-feature-detect", resolveFrom: "@jsquash/avif", version: "1.9.0" },
];
const deniedLicensePattern = /(?:^|[^A-Z])(?:AGPL|GPL|LGPL)(?:-|\b)/i;
const failures = [];
const packageLicenses = [];
const codecLicenseEvidence = [];

function resolvePackageManifest(packageName, resolveFrom) {
  if (!resolveFrom) return require.resolve(`${packageName}/package.json`);
  const parentManifest = require.resolve(`${resolveFrom}/package.json`);
  return createRequire(parentManifest).resolve(`${packageName}/package.json`);
}

for (const { name: packageName, resolveFrom, version: expectedVersion } of expectedPackages) {
  const manifestPath = resolvePackageManifest(packageName, resolveFrom);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const license = String(manifest.license ?? "NOASSERTION");
  packageLicenses.push({ license, name: packageName, version: manifest.version });

  if (manifest.version !== expectedVersion) {
    failures.push(`${packageName} version ${manifest.version} does not match ${expectedVersion}.`);
  }
  if (license === "NOASSERTION" || deniedLicensePattern.test(license)) {
    failures.push(
      `${packageName}@${manifest.version} has disallowed or unknown license ${license}.`,
    );
  }
  const licenseText = await readFile(resolve(dirname(manifestPath), "LICENSE"), "utf8");
  if (deniedLicensePattern.test(licenseText)) {
    failures.push(`${packageName}@${manifest.version} LICENSE contains a copyleft marker.`);
  }
}

for (const packageName of ["@jsquash/jpeg", "@jsquash/png", "@jsquash/webp"]) {
  const manifestPath = resolvePackageManifest(packageName);
  const evidencePath = resolve(dirname(manifestPath), "codec/LICENSE.codec.md");
  const evidenceText = await readFile(evidencePath, "utf8");
  codecLicenseEvidence.push({ packageName, path: evidencePath });
  if (deniedLicensePattern.test(evidenceText)) {
    failures.push(`${packageName} codec license evidence contains a copyleft marker.`);
  }
}

for (const component of inventory.components) {
  if (!component.name || !component.version || !component.source || !component.license) {
    failures.push(
      `Native component inventory contains an incomplete record: ${JSON.stringify(component)}.`,
    );
  } else if (deniedLicensePattern.test(component.license)) {
    failures.push(
      `${component.name}@${component.version} has disallowed license ${component.license}.`,
    );
  }
}

const artifacts = [];
for (const artifact of inventory.artifacts) {
  const manifestPath = require.resolve(`${artifact.packageName}/package.json`);
  const artifactPath = resolve(dirname(manifestPath), artifact.path);
  const bytes = await readFile(artifactPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  artifacts.push({
    bytes: (await stat(artifactPath)).size,
    packageName: artifact.packageName,
    path: artifact.path,
    sha256,
  });
  if (sha256 !== artifact.sha256) {
    failures.push(`${artifact.packageName}/${artifact.path} has unexpected SHA-256 ${sha256}.`);
  }
}

const report = {
  compatibleWithImgConvertPolicy: failures.length === 0,
  inventory: fileURLToPath(new URL("../licenses/native-codecs.json", import.meta.url)),
  packageDirectory,
  packageLicenses,
  codecLicenseEvidence,
  nativeComponents: inventory.components,
  sourceRepository: inventory.sourceRepository,
  sourceRevision: inventory.sourceRevision,
  artifacts,
  failures,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) {
  process.stderr.write("Independent codec candidate failed the bundle license/integrity gate.\n");
  process.exitCode = 1;
}
