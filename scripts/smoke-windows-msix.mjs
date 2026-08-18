// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
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
  keepInstalled: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--allow-non-windows") {
    options.allowNonWindows = true;
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
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function main() {
  if (!isWindows && !options.allowNonWindows) {
    fail(
      "Windows MSIX install smoke must run on Windows. Pass --allow-non-windows only for preflight.",
    );
  }

  const preparedManifest = readPreparedManifest();
  const version = manifestValue(preparedManifest, "Version");
  const packagePath = path.join(msixRoot, `ImgConvert_${version}_x64.msix`);
  if (!existsSync(packagePath)) {
    fail(
      `expected artifact ${path.relative(repoRoot, packagePath)} was not found; run pnpm run release:windows:msix first`,
    );
  }

  if (!isWindows) {
    const identityName = xmlUnescape(manifestValue(preparedManifest, "Name"));
    const publisher = xmlUnescape(manifestValue(preparedManifest, "Publisher"));
    console.log(
      `preflight artifact ${path.relative(repoRoot, packagePath)} (${statSync(packagePath).size} bytes)`,
    );
    console.log(`preflight identity ${identityName} / ${publisher}`);
    return;
  }

  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "imgconvert-windows-msix-smoke-"));
  const packageManifest = unpackPackageManifest(packagePath);
  const identityName = xmlUnescape(manifestValue(packageManifest, "Name"));
  const publisher = xmlUnescape(manifestValue(packageManifest, "Publisher"));
  let certificateThumbprint = null;
  let packageInstalled = false;

  try {
    ensurePackageAbsent(identityName);
    certificateThumbprint = createSmokeCertificate(publisher);
    signPackage(packagePath);
    trustSmokeCertificate(certificateThumbprint);
    installPackage(packagePath);
    packageInstalled = true;
    runInstalledSmoke(identityName);
    console.log("Windows MSIX install smoke completed.");
  } finally {
    if (packageInstalled && !options.keepInstalled) {
      removePackage(identityName);
    }
    if (certificateThumbprint && !options.keepInstalled) {
      removeCertificate(certificateThumbprint);
    }
    if (!options.keepInstalled) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
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

function unpackPackageManifest(packagePath) {
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
  return readFileSync(manifestPath, "utf8");
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
      "$cert = New-SelfSignedCertificate -Type Custom -Subject $env:MSIX_SMOKE_SUBJECT -KeyUsage DigitalSignature -FriendlyName 'ImgConvert MSIX smoke' -CertStoreLocation 'Cert:\\CurrentUser\\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')",
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
    for (const version of versions) {
      const candidate = path.join(kitsRoot, version, "x64", tool);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function runPowerShell(script, label, runOptions = {}) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    label,
    { ...runOptions, capture: true },
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

Signs the .msix matching the prepared manifest version with a temporary
self-signed certificate matching the package's own manifest publisher (read by
unpacking the .msix), sideloads it, and runs the hidden package conversion
smoke from the installed ImgConvert.exe. Requires an elevated (Administrator)
shell so the smoke certificate can be trusted. The smoke refuses to run when a
package with the same identity is already installed for the current user.

Options:
  --allow-non-windows     Allow non-Windows artifact preflight.
  --keep-installed        Leave the package, certificate, and temp directory in place.
`);
}

function fail(message) {
  throw new Error(message);
}
