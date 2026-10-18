// SPDX-License-Identifier: Apache-2.0
// Internal SDK interoperability only. Never contacts a production update endpoint.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  copyFile,
  chmod,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLegacyUpdaterVersion } from "./gpui-updater-manifest.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
  throw new Error("Native Linux x64/arm64 required");
const root = await mkdtemp(path.join(tmpdir(), "imgconvert-updater-smoke-"));
const cleanEnv = {
  ...process.env,
  APPIMAGE_EXTRACT_AND_RUN: "1",
  CARGO_BUILD_JOBS: "2",
  TMPDIR: root,
};
for (const key of [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "TAURI_SIGNING_PRIVATE_KEY_PATH",
  "TAURI_UPDATER_PUBKEY",
  "CARGO_PACKAGER_SIGN_PRIVATE_KEY",
  "CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD",
  "APPIMAGE",
  "APPDIR",
])
  delete cleanEnv[key];
let server;
let serial = 0;
async function run(command, args, label, env = cleanEnv, cwd = repo) {
  const log = path.join(root, `${++serial}-${label}.log`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    const append = (chunk) => {
      if (output.length < 32 * 1024 * 1024) output += chunk.toString();
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already exited */
      }
    }, 20 * 60_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", async (code) => {
      clearTimeout(timeout);
      // The signer can print the ephemeral private key. Never retain its output.
      if (label !== "generate-key") await writeFile(log, output);
      if (code !== 0) reject(new Error(`${label} failed (${code}); see ${log}`));
      else resolve(output);
    });
  });
}
async function images(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...(await images(full)));
    else if (item.name.endsWith(".AppImage")) result.push(full);
  }
  return result;
}
async function build(version, name) {
  const dir = path.join(root, name);
  const bin = path.join(dir, "bin");
  const out = path.join(dir, "packages");
  await mkdir(bin, { recursive: true });
  await mkdir(out);
  const source = path.join(dir, "main.rs");
  await writeFile(source, `fn main() { println!("ImgConvert updater fixture ${version}"); }\n`);
  await run("rustc", [source, "-o", path.join(bin, "imgconvert-updater-smoke")], `compile-${name}`);
  const config = path.join(dir, "packager.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "imgconvert-updater-smoke",
      productName: "ImgConvertUpdaterSmoke",
      version,
      identifier: "com.ivmm.imgconvert.updater-smoke",
      binaries: [{ path: "imgconvert-updater-smoke", main: true }],
      binariesDir: bin,
      outDir: out,
      formats: ["appimage"],
      icons: [path.join(repo, "src-tauri/icons/128x128.png")],
      description: "Internal ImgConvert updater compatibility fixture",
      licenseFile: path.join(repo, "LICENSE"),
    }),
  );
  await run("cargo", ["packager", "--config", config], `package-${name}`);
  const packages = await images(out);
  if (packages.length !== 1) throw new Error("Expected one native cargo-packager AppImage");
  return packages[0];
}
try {
  await writeFile(path.join(root, ".imgconvert-updater-smoke"), "internal fixture\n");
  const old = await build("0.3.1", "old");
  const candidate = await build("0.4.1", "new");
  for (const name of ["tauri-old.AppImage", "gpui-old.AppImage"]) {
    await copyFile(old, path.join(root, name));
    await chmod(path.join(root, name), 0o755);
  }
  await run(
    "pnpm",
    [
      "exec",
      "tauri",
      "signer",
      "generate",
      "--ci",
      "--password",
      "",
      "--write-keys",
      path.join(root, "test.key"),
    ],
    "generate-key",
  );
  await run(
    "pnpm",
    [
      "exec",
      "tauri",
      "signer",
      "sign",
      "--private-key-path",
      path.join(root, "test.key"),
      "--password",
      "",
      candidate,
    ],
    "sign",
  );
  const signature = (await readFile(`${candidate}.sig`, "utf8")).trim();
  const body = await readFile(candidate);
  const target = `linux-${process.arch === "x64" ? "x86_64" : "aarch64"}`;
  let manifest;
  const legacy = { version: "0.3.2", platforms: {} };
  assertLegacyUpdaterVersion(legacy.version);
  server = createServer((request, response) => {
    if (request.url === "/new.AppImage") {
      response.writeHead(200, { "Content-Length": body.length });
      response.end(body);
    } else if (request.url === "/latest-v2.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(manifest));
    } else if (request.url === "/latest.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(legacy));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  manifest = {
    version: "0.4.1",
    minimum_system_version: { linux: "0" },
    platforms: { [target]: { url: `${base}/new.AppImage`, signature, format: "appimage" } },
  };
  const env = {
    ...cleanEnv,
    IMGCONVERT_INTERNAL_UPDATER_SMOKE: "1",
    IMGCONVERT_UPDATER_SMOKE_ROOT: root,
    IMGCONVERT_UPDATER_SMOKE_ENDPOINT: `${base}/latest-v2.json`,
  };
  await run(
    "cargo",
    [
      "run",
      "--locked",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--example",
      "updater_compat_smoke",
      "--features",
      "updater-test",
    ],
    "tauri-sdk",
    env,
  );
  await run(
    "cargo",
    ["run", "--manifest-path", "tools/gpui-updater-interop/Cargo.toml", "--locked"],
    "packager-sdk",
    env,
  );
  const digest = createHash("sha256").update(body).digest("hex");
  for (const name of ["tauri-old.AppImage", "gpui-old.AppImage"]) {
    const installed = await readFile(path.join(root, name));
    if (createHash("sha256").update(installed).digest("hex") !== digest)
      throw new Error(`${name} did not install the exact signed candidate`);
    const result = await run(path.join(root, name), ["--version"], `launch-${name}`, env);
    if (!result.includes("ImgConvert updater fixture 0.4.1"))
      throw new Error("Installed AppImage did not run the new binary");
  }
  const report = {
    schemaVersion: 1,
    target,
    sourceSha: process.env.GITHUB_SHA ?? null,
    scope:
      "Native updater SDK signature/download/install/run; excludes the real Tauri/GPUI GUI, settings migration and GPU eligibility",
    cargoPackager: "0.11.8",
    cargoPackagerUpdater: "0.2.3",
    sameEphemeralTauriSigningKey: true,
    tauriSdkInstalled: true,
    packagerSdkInstalled: true,
    installedPackageSha256: digest,
    legacyEndpointVersion: legacy.version,
    productionEndpointsContacted: false,
  };
  const destination = path.resolve(
    process.env.IMGCONVERT_UPDATER_SMOKE_REPORT ??
      path.join(repo, "target/updater-compat", `${target}.json`),
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Updater SDK interoperability passed for ${target}: ${destination}`);
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(path.join(root, "test.key"), { force: true });
}
