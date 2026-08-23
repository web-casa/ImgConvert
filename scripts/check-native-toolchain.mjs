// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import os from "node:os";

const skip = /^(1|true|yes|on)$/i.test(process.env.IMGCONVERT_SKIP_NATIVE_TOOLCHAIN_CHECK ?? "");
const options = {
  linuxBundles: [],
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg.startsWith("--linux-bundles=")) {
    options.linuxBundles = arg
      .slice("--linux-bundles=".length)
      .split(",")
      .map((bundle) => bundle.trim().toLowerCase())
      .filter(Boolean);
  } else {
    console.error(`unknown argument: ${arg}`);
    process.exit(1);
  }
}

if (skip) {
  console.log("native toolchain check skipped by IMGCONVERT_SKIP_NATIVE_TOOLCHAIN_CHECK.");
  process.exit(0);
}

const arch = os.arch();
const platform = os.platform();
const checks = [
  {
    name: "cmake",
    commands: [["cmake", ["--version"]]],
    reason: "C/C++ codec build scripts",
  },
  {
    name: "meson",
    commands: [["meson", ["--version"]]],
    reason: "dav1d/libavif native build scripts",
  },
  {
    name: "ninja",
    commands: [
      ["ninja", ["--version"]],
      ["ninja-build", ["--version"]],
    ],
    reason: "meson/cmake native builds",
  },
];

if (["x64", "ia32"].includes(arch)) {
  checks.push({
    name: "nasm",
    commands: [["nasm", ["-v"]]],
    reason: "x86/x86_64 codec assembly",
  });
}

if (options.linuxBundles.length > 0) {
  if (platform !== "linux") {
    console.error("--linux-bundles can only be checked on Linux hosts");
    process.exit(1);
  }
  addLinuxBundleChecks(options.linuxBundles);
}

const failures = [];

for (const check of checks) {
  const result = runAny(check.commands);
  if (result) {
    console.log(`${check.name}: ${firstLine(result.stdout || result.stderr)}`);
  } else {
    failures.push(`${check.name} is required for ${check.reason}`);
  }
}

if (failures.length > 0) {
  console.error(`native toolchain check failed on ${platform}/${arch}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(
    "Install the missing tools before building release artifacts. On Debian/Ubuntu this is usually: sudo apt install cmake meson ninja-build nasm rpm cpio binutils file desktop-file-utils appstream squashfs-tools patchelf",
  );
  process.exit(1);
}

console.log(`native toolchain check passed on ${platform}/${arch}.`);

function runAny(commands) {
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0) {
      return result;
    }
  }
  return null;
}

function addLinuxBundleChecks(bundles) {
  const unique = new Set(bundles);
  for (const bundle of unique) {
    if (!["deb", "rpm", "appimage"].includes(bundle)) {
      console.error(`unsupported Linux bundle: ${bundle}`);
      process.exit(1);
    }
  }

  if (unique.has("deb")) {
    checks.push({
      name: "dpkg-deb",
      commands: [["dpkg-deb", ["--version"]]],
      reason: ".deb artifact inspection",
    });
  }
  if (unique.has("rpm")) {
    checks.push(
      {
        name: "rpm",
        commands: [["rpm", ["--version"]]],
        reason: ".rpm artifact build and inspection",
      },
      {
        name: "rpm2cpio",
        commands: [["rpm2cpio", ["--help"]]],
        reason: ".rpm payload extraction for ELF inspection",
      },
      {
        name: "cpio",
        commands: [["cpio", ["--version"]]],
        reason: ".rpm payload extraction for ELF inspection",
      },
    );
  }
  checks.push(
    {
      name: "file",
      commands: [["file", ["--version"]]],
      reason: "Linux executable architecture inspection",
    },
    {
      name: "ldd",
      commands: [["ldd", ["--version"]]],
      reason: "Linux runtime dependency inspection",
    },
    {
      name: "readelf",
      commands: [["readelf", ["--version"]]],
      reason: "Linux GLIBC baseline inspection",
    },
  );
  if (unique.has("appimage")) {
    checks.push(
      {
        name: "desktop-file-validate",
        commands: [["desktop-file-validate", ["--help"]]],
        reason: "Linux desktop entry validation",
      },
      {
        name: "appstreamcli",
        commands: [["appstreamcli", ["--version"]]],
        reason: "AppStream metadata validation",
      },
      {
        name: "mksquashfs",
        commands: [["mksquashfs", ["-version"]]],
        reason: "AppImage squashfs generation",
      },
      {
        name: "patchelf",
        commands: [["patchelf", ["--version"]]],
        reason: "AppImage ELF patching",
      },
    );
  }
}

function firstLine(text) {
  return text.trim().split(/\r?\n/, 1)[0] || "ok";
}
