// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = os.platform() === "win32";
const msixRoot = path.join(repoRoot, "src-tauri", "target", "windows-msix");
let tmpRoot = null;
let smokePassword = null;

const options = {
  allowNonWindows: false,
  exportSignedDir: null,
  keepInstalled: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--allow-non-windows") {
    options.allowNonWindows = true;
  } else if (arg.startsWith("--export-signed-dir=")) {
    const value = arg.slice("--export-signed-dir=".length).trim();
    if (!value) {
      console.error("--export-signed-dir requires a non-empty path");
      process.exit(1);
    }
    options.exportSignedDir = path.resolve(repoRoot, value);
  } else if (arg === "--keep-installed") {
    options.keepInstalled = true;
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    console.error(`unknown argument: ${arg}`);
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function main() {
  if (!isWindows && !options.allowNonWindows) {
    fail(
      "Windows MSIX install smoke must run on Windows. Pass --allow-non-windows only for preflight.",
    );
  }

  const preparedManifest = readPreparedManifest();
  const version = manifestValue(preparedManifest, "Version");
  const architecture = manifestValue(preparedManifest, "ProcessorArchitecture");
  if (!["x64", "arm64"].includes(architecture)) {
    fail(`unsupported MSIX processor architecture: ${architecture}`);
  }
  const sourcePackagePath = path.join(msixRoot, `ImgConvert_${version}_${architecture}.msix`);
  if (!existsSync(sourcePackagePath)) {
    fail(
      `expected artifact ${path.relative(repoRoot, sourcePackagePath)} was not found; run pnpm run release:windows:msix first`,
    );
  }

  if (!isWindows) {
    const identityName = xmlUnescape(manifestValue(preparedManifest, "Name"));
    const publisher = xmlUnescape(manifestValue(preparedManifest, "Publisher"));
    console.log(
      `preflight artifact ${path.relative(repoRoot, sourcePackagePath)} (${statSync(sourcePackagePath).size} bytes)`,
    );
    console.log(`preflight identity ${identityName} / ${publisher}`);
    return;
  }

  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "imgconvert-windows-msix-smoke-"));
  let identityName = null;
  let certificateThumbprint = null;
  let packageInstalled = false;

  try {
    const sourceArtifactSha256 = sha256File(sourcePackagePath);
    const unpackedPackage = unpackPackage(sourcePackagePath);
    ensurePackagedManifestMatchesPrepared(preparedManifest, unpackedPackage.manifest);
    verifyPackagedExecutableArchitecture(unpackedPackage.root, architecture);
    identityName = xmlUnescape(manifestValue(unpackedPackage.manifest, "Name"));
    const publisher = xmlUnescape(manifestValue(unpackedPackage.manifest, "Publisher"));
    const smokePackagePath = path.join(requiredTmpRoot(), path.basename(sourcePackagePath));
    copyFileSync(sourcePackagePath, smokePackagePath);
    ensurePackageAbsent(identityName);
    certificateThumbprint = createSmokeCertificate(publisher);
    signPackage(smokePackagePath);
    trustSmokeCertificate(certificateThumbprint);
    verifyPackageSignature(smokePackagePath);
    installPackage(smokePackagePath);
    packageInstalled = true;
    runInstalledSmoke(identityName);
    assertSourceArtifactUnchanged(sourcePackagePath, sourceArtifactSha256);
    exportSignedSmokeBundle(smokePackagePath, version, architecture, identityName, publisher);
    console.log(
      "Windows MSIX install smoke completed; source submission artifact was not modified (SHA-256 verified).",
    );
  } finally {
    if (packageInstalled && identityName && !options.keepInstalled) {
      removePackage(identityName);
    }
    if (certificateThumbprint && !options.keepInstalled) {
      removeCertificate(certificateThumbprint);
    }
    if (!options.keepInstalled) {
      await removeTemporaryRoot(tmpRoot);
    }
  }
}

async function removeTemporaryRoot(directory) {
  // AppX can briefly retain a handle after package removal on Windows.
  // The promise API schedules retry delays for Windows EPERM/EBUSY cleanup.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function readPreparedManifest() {
  const manifestPath = path.join(msixRoot, "AppxManifest.xml");
  if (!existsSync(manifestPath)) {
    fail(
      "prepared AppxManifest.xml was not found; run pnpm run release:windows:msix:prepare first",
    );
  }
  return readFileSync(manifestPath, "utf8");
}

function manifestValue(manifest, attribute) {
  const value = manifest.match(new RegExp(`<Identity[^>]*\\s${attribute}="([^"]+)"`))?.[1];
  if (!value) {
    fail(`package manifest is missing Identity ${attribute}`);
  }
  return value;
}

function unpackPackage(packagePath) {
  const makeappx = findWindowsSdkTool("makeappx.exe");
  if (!makeappx) {
    fail("makeappx.exe was not found; install the Windows 10/11 SDK before MSIX inspection");
  }
  const unpackDir = path.join(requiredTmpRoot(), "unpacked");
  run(
    makeappx,
    ["unpack", "/p", packagePath, "/d", unpackDir],
    "unpack MSIX for identity verification",
  );
  const manifestPath = path.join(unpackDir, "AppxManifest.xml");
  if (!existsSync(manifestPath)) {
    fail("unpacked MSIX does not contain AppxManifest.xml");
  }
  return { manifest: readFileSync(manifestPath, "utf8"), root: unpackDir };
}

function ensurePackagedManifestMatchesPrepared(preparedManifest, packageManifest) {
  for (const attribute of ["Name", "Publisher", "Version", "ProcessorArchitecture"]) {
    const expected = xmlUnescape(manifestValue(preparedManifest, attribute));
    const actual = xmlUnescape(manifestValue(packageManifest, attribute));
    if (actual !== expected) {
      fail(
        `packed MSIX Identity ${attribute} does not match the prepared manifest: expected ${expected}, got ${actual}`,
      );
    }
  }
}

function verifyPackagedExecutableArchitecture(packageRoot, expectedArchitecture) {
  const executable = path.join(packageRoot, "ImgConvert.exe");
  if (!existsSync(executable)) {
    fail("unpacked MSIX does not contain ImgConvert.exe");
  }
  const actualArchitecture = peProcessorArchitecture(executable);
  if (actualArchitecture !== expectedArchitecture) {
    fail(
      `packed MSIX ImgConvert.exe architecture does not match the manifest: expected ${expectedArchitecture}, got ${actualArchitecture}`,
    );
  }
}

function peProcessorArchitecture(file) {
  const binary = readFileSync(file);
  if (binary.length < 0x40 || binary.readUInt16LE(0) !== 0x5a4d) {
    fail(`${file} is not a valid PE executable (missing MZ header)`);
  }
  const peOffset = binary.readUInt32LE(0x3c);
  if (peOffset > binary.length - 6 || binary.readUInt32LE(peOffset) !== 0x00004550) {
    fail(`${file} is not a valid PE executable (missing PE header)`);
  }
  const machine = binary.readUInt16LE(peOffset + 4);
  if (machine === 0x8664) return "x64";
  if (machine === 0xaa64) return "arm64";
  fail(`${file} uses unsupported PE machine type 0x${machine.toString(16).padStart(4, "0")}`);
}

function assertSourceArtifactUnchanged(sourcePackagePath, expectedSha256) {
  const actualSha256 = sha256File(sourcePackagePath);
  if (actualSha256 !== expectedSha256) {
    fail(
      `source submission artifact changed during the smoke: expected SHA-256 ${expectedSha256}, got ${actualSha256}`,
    );
  }
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function xmlUnescape(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function ensurePackageAbsent(identityName) {
  const query = runPowerShell(
    "(Get-AppxPackage -Name $env:MSIX_SMOKE_IDENTITY -ErrorAction SilentlyContinue | Measure-Object).Count",
    "check for an existing package with the smoke identity",
    { env: { MSIX_SMOKE_IDENTITY: identityName } },
  );
  const count = Number.parseInt(query.stdout.trim().split(/\r?\n/).pop()?.trim() ?? "", 10);
  if (count > 0) {
    fail(
      `package ${identityName} is already installed for this user; refusing to replace it. Uninstall it yourself before running the smoke.`,
    );
  }
}

function createSmokeCertificate(publisher) {
  smokePassword = `msix-smoke-${randomUUID()}`;
  const create = runPowerShell(
    [
      "$sec = ConvertTo-SecureString -String $env:MSIX_SMOKE_PASSWORD -Force -AsPlainText",
      "$cert = New-SelfSignedCertificate -Type Custom -Subject $env:MSIX_SMOKE_SUBJECT -KeyUsage DigitalSignature -FriendlyName 'ImgConvert MSIX smoke' -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddDays(7) -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')",
      "Export-PfxCertificate -Cert $cert -FilePath $env:MSIX_SMOKE_PFX -Password $sec | Out-Null",
      "$cert.Thumbprint",
    ].join("; "),
    "create self-signed MSIX smoke certificate",
    {
      env: {
        MSIX_SMOKE_PASSWORD: smokePassword,
        MSIX_SMOKE_SUBJECT: publisher,
        MSIX_SMOKE_PFX: path.join(requiredTmpRoot(), "msix-smoke.pfx"),
      },
    },
  );
  const thumbprint = create.stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!thumbprint) {
    fail("self-signed MSIX smoke certificate did not report a thumbprint");
  }
  return thumbprint;
}

function signPackage(packagePath) {
  const signtool = findWindowsSdkTool("signtool.exe");
  if (!signtool) {
    fail("signtool.exe was not found; install the Windows 10/11 SDK before MSIX signing");
  }
  run(
    signtool,
    [
      "sign",
      "/fd",
      "SHA256",
      "/f",
      path.join(requiredTmpRoot(), "msix-smoke.pfx"),
      "/p",
      smokePassword,
      packagePath,
    ],
    "sign MSIX with smoke certificate",
  );
}

function trustSmokeCertificate(thumbprint) {
  runPowerShell(
    [
      'Export-Certificate -Cert "Cert:\\CurrentUser\\My\\$env:MSIX_SMOKE_THUMBPRINT" -FilePath $env:MSIX_SMOKE_CER | Out-Null',
      "Import-Certificate -FilePath $env:MSIX_SMOKE_CER -CertStoreLocation 'Cert:\\LocalMachine\\TrustedPeople' | Out-Null",
    ].join("; "),
    "trust MSIX smoke certificate (requires an elevated prompt)",
    {
      env: {
        MSIX_SMOKE_THUMBPRINT: thumbprint,
        MSIX_SMOKE_CER: path.join(requiredTmpRoot(), "msix-smoke.cer"),
      },
    },
  );
}

function verifyPackageSignature(packagePath) {
  const signtool = findWindowsSdkTool("signtool.exe");
  if (!signtool) {
    fail("signtool.exe was not found; install the Windows 10/11 SDK before MSIX verification");
  }
  run(signtool, ["verify", "/pa", "/all", packagePath], "verify signed MSIX smoke package");
}

function exportSignedSmokeBundle(packagePath, version, architecture, identityName, publisher) {
  const outputDir = options.exportSignedDir;
  if (!outputDir) return;

  if (identityName !== "ImgConvert.DevSmoke" || publisher !== "CN=ImgConvertDevSmoke") {
    fail(
      `signed export is restricted to the isolated DevSmoke identity; got ${identityName} / ${publisher}`,
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const packageName = `ImgConvert_${version}_${architecture}_DevSmoke.msix`;
  const certificateName = "ImgConvert.DevSmoke.cer";
  const outputPackagePath = path.join(outputDir, packageName);
  const outputCertificatePath = path.join(outputDir, certificateName);
  const outputReadmePath = path.join(outputDir, "INSTALL.txt");
  const outputChecksumsPath = path.join(outputDir, "SHA256SUMS.txt");
  for (const outputPath of [
    outputPackagePath,
    outputCertificatePath,
    outputReadmePath,
    outputChecksumsPath,
  ]) {
    if (existsSync(outputPath)) {
      fail(`refusing to overwrite existing DevSmoke export: ${outputPath}`);
    }
  }

  copyFileSync(packagePath, outputPackagePath);
  copyFileSync(path.join(requiredTmpRoot(), "msix-smoke.cer"), outputCertificatePath);
  writeFileSync(
    outputReadmePath,
    [
      "ImgConvert DevSmoke MSIX (development testing only)",
      "",
      "This package uses a temporary self-signed certificate. Do not redistribute it as a production release.",
      "",
      "Install from an elevated Windows PowerShell prompt:",
      `  Import-Certificate -FilePath .\\${certificateName} -CertStoreLocation Cert:\\LocalMachine\\TrustedPeople`,
      `  Add-AppxPackage -Path .\\${packageName}`,
      "",
      "Remove the package and development certificate after testing:",
      `  Get-AppxPackage -Name ${powerShellSingleQuoted(identityName)} | Remove-AppxPackage`,
      `  $thumbprint = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path ${powerShellSingleQuoted(`.\\${certificateName}`)})).Thumbprint`,
      "  Get-ChildItem Cert:\\LocalMachine\\TrustedPeople | Where-Object Thumbprint -eq $thumbprint | Remove-Item",
      "",
    ].join("\r\n"),
  );
  writeFileSync(
    outputChecksumsPath,
    [
      `${sha256File(outputPackagePath)} *${packageName}`,
      `${sha256File(outputCertificatePath)} *${certificateName}`,
      "",
    ].join("\n"),
  );
  console.log(`Signed DevSmoke MSIX bundle exported to ${path.relative(repoRoot, outputDir)}`);
}

function powerShellSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function installPackage(packagePath) {
  runPowerShell(
    "Add-AppxPackage -Path $env:MSIX_SMOKE_PACKAGE -ForceUpdateFromAnyVersion",
    "sideload MSIX package",
    { env: { MSIX_SMOKE_PACKAGE: packagePath } },
  );
}

function runInstalledSmoke(identityName) {
  const query = runPowerShell(
    "(Get-AppxPackage -Name $env:MSIX_SMOKE_IDENTITY).InstallLocation",
    "locate installed MSIX package",
    { env: { MSIX_SMOKE_IDENTITY: identityName } },
  );
  const installLocation = query.stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!installLocation) {
    fail(`installed package ${identityName} did not report an InstallLocation`);
  }
  const executable = path.join(installLocation, "ImgConvert.exe");
  if (!existsSync(executable)) {
    fail(`installed ImgConvert.exe was not found at ${executable}`);
  }
  run(executable, [], "installed MSIX package conversion smoke", {
    env: {
      IMGCONVERT_PACKAGE_CONVERT_SMOKE: "1",
      IMGCONVERT_PACKAGE_CONVERT_SMOKE_FORMATS: "jpeg,webp,png,avif",
      IMGCONVERT_PACKAGE_CONVERT_SMOKE_DIR: path.join(requiredTmpRoot(), "msix-convert"),
    },
  });
}

function removePackage(identityName) {
  runPowerShell(
    "Get-AppxPackage -Name $env:MSIX_SMOKE_IDENTITY | Remove-AppxPackage -ErrorAction SilentlyContinue",
    "remove MSIX smoke package",
    { allowFailure: true, env: { MSIX_SMOKE_IDENTITY: identityName } },
  );
}

function removeCertificate(thumbprint) {
  runPowerShell(
    [
      'Remove-Item "Cert:\\LocalMachine\\TrustedPeople\\$env:MSIX_SMOKE_THUMBPRINT" -ErrorAction SilentlyContinue',
      'Remove-Item "Cert:\\CurrentUser\\My\\$env:MSIX_SMOKE_THUMBPRINT" -ErrorAction SilentlyContinue',
    ].join("; "),
    "remove MSIX smoke certificate",
    { allowFailure: true, env: { MSIX_SMOKE_THUMBPRINT: thumbprint } },
  );
}

function findWindowsSdkTool(tool) {
  const pathDirs = String(process.env.Path ?? process.env.PATH ?? "").split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, tool);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  const kitsRoot = process.env["ProgramFiles(x86)"]
    ? path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin")
    : null;
  if (kitsRoot && existsSync(kitsRoot)) {
    const versions = readdirSync(kitsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^10\.\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    const toolArchitectures = process.arch === "arm64" ? ["arm64", "x64"] : ["x64"];
    for (const version of versions) {
      for (const architecture of toolArchitectures) {
        const candidate = path.join(kitsRoot, version, architecture, tool);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

function runPowerShell(script, label, runOptions = {}) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const env = { ...process.env, ...(runOptions.env ?? {}) };
  // GitHub Actions sometimes inherits a PowerShell 7 module path when spawning
  // Windows PowerShell 5.1, which breaks Security/PKI autoload and the Cert:
  // drive. Restore the Windows PowerShell module roots explicitly.
  const windows = process.env.WINDIR ?? "C:\\Windows";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  env.PSModulePath = [
    path.join(windows, "System32", "WindowsPowerShell", "v1.0", "Modules"),
    path.join(programFiles, "WindowsPowerShell", "Modules"),
  ].join(path.delimiter);
  return run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    label,
    { ...runOptions, env, capture: true },
  );
}

function run(command, args, label, runOptions = {}) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...(runOptions.env ?? {}) },
    stdio: runOptions.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: runOptions.capture ? "utf8" : undefined,
  });
  if (result.error) {
    if (runOptions.allowFailure) {
      console.warn(`${label} failed to start: ${result.error.message}`);
      return { stdout: "" };
    }
    fail(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (runOptions.allowFailure) {
      console.warn(`${label} failed with exit code ${result.status ?? 1}`);
      return { stdout: result.stdout ?? "" };
    }
    fail(`${label} failed with exit code ${result.status ?? 1}`);
  }
  return { stdout: result.stdout ?? "" };
}

function requiredTmpRoot() {
  if (!tmpRoot) {
    fail("temporary MSIX smoke directory was not initialized");
  }
  return tmpRoot;
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-windows-msix.mjs [options]

Copies the .msix matching the prepared manifest version into a temporary
directory, verifies the packed identity matches that prepared manifest, signs
only the copy with a temporary self-signed certificate matching the package's
own manifest publisher, sideloads it, and runs the hidden package conversion
smoke from the installed ImgConvert.exe. The source submission artifact is not
modified and is SHA-256 checked before and after the smoke. Requires an elevated
(Administrator) shell so the smoke certificate can be trusted. The smoke refuses
to run when a package with the same identity is already installed for the current
user.

Options:
  --allow-non-windows     Allow non-Windows artifact preflight.
  --export-signed-dir=DIR Export the tested signed MSIX, public .cer, checksums, and install guide.
  --keep-installed        Leave the package, certificate, and temp directory in place.
`);
}

function fail(message) {
  throw new Error(message);
}
