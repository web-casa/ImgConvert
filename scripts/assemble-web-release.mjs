// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_RELEASE_FILES = 50_000;
const MAX_RELEASE_BYTES = 512 * 1024 * 1024;

function invariant(condition, message) {
  if (!condition) throw new Error(`Web release assembly refused: ${message}`);
}

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..")
  );
}

async function assertPlainDirectory(pathname, label) {
  const stats = await lstat(pathname);
  invariant(!stats.isSymbolicLink(), `${label} must not be a symbolic link`);
  invariant(stats.isDirectory(), `${label} must be a directory`);
}

async function validateTree(root, label, allowEmpty = false) {
  const budget = { bytes: 0, files: 0 };

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      invariant(entry.name !== "." && entry.name !== "..", `${label} contains an unsafe name`);
      invariant(!isAbsolute(entry.name), `${label} contains an absolute path`);
      invariant(
        !entry.name.includes("/") && !entry.name.includes("\\"),
        `${label} contains a path separator`,
      );

      const child = resolve(directory, entry.name);
      invariant(isWithin(root, child), `${label} contains directory traversal`);
      const stats = await lstat(child);
      invariant(
        !stats.isSymbolicLink(),
        `${label} contains a symbolic link: ${relative(root, child)}`,
      );

      if (stats.isDirectory()) {
        await visit(child);
        continue;
      }

      invariant(stats.isFile(), `${label} contains a non-regular file: ${relative(root, child)}`);
      budget.files += 1;
      budget.bytes += stats.size;
      invariant(budget.files <= MAX_RELEASE_FILES, `${label} exceeds ${MAX_RELEASE_FILES} files`);
      invariant(budget.bytes <= MAX_RELEASE_BYTES, `${label} exceeds ${MAX_RELEASE_BYTES} bytes`);
    }
  }

  await visit(root);
  invariant(allowEmpty || budget.files > 0, `${label} is empty`);
  return budget;
}

async function copyTree(sourceRoot, destinationRoot) {
  async function visit(sourceDirectory, destinationDirectory) {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const source = resolve(sourceDirectory, entry.name);
      const destination = resolve(destinationDirectory, entry.name);
      invariant(isWithin(sourceRoot, source), "source path escaped web-app/dist");
      invariant(
        isWithin(destinationRoot, destination),
        "destination path escaped staging directory",
      );

      const stats = await lstat(source);
      invariant(
        !stats.isSymbolicLink(),
        `source changed to a symbolic link: ${relative(sourceRoot, source)}`,
      );

      if (stats.isDirectory()) {
        await mkdir(destination);
        await visit(source, destination);
      } else {
        invariant(
          stats.isFile(),
          `source changed to a non-regular file: ${relative(sourceRoot, source)}`,
        );
        await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
      }
    }
  }

  await visit(sourceRoot, destinationRoot);
}

export async function assembleWebRelease(repositoryRoot) {
  const lexicalRoot = resolve(repositoryRoot);
  const canonicalRoot = await realpath(lexicalRoot);
  const websiteDist = resolve(canonicalRoot, "website/dist");
  const webAppDist = resolve(canonicalRoot, "web-app/dist");
  const destination = resolve(websiteDist, "convert");

  invariant(isWithin(canonicalRoot, websiteDist), "website/dist escaped the repository root");
  invariant(isWithin(canonicalRoot, webAppDist), "web-app/dist escaped the repository root");
  invariant(isWithin(websiteDist, destination), "convert destination escaped website/dist");
  invariant(
    destination === resolve(canonicalRoot, "website/dist/convert"),
    "unexpected destination",
  );

  await assertPlainDirectory(websiteDist, "website/dist");
  await assertPlainDirectory(webAppDist, "web-app/dist");
  invariant(
    (await realpath(websiteDist)) === websiteDist,
    "website/dist has a symbolic-link parent",
  );
  invariant((await realpath(webAppDist)) === webAppDist, "web-app/dist has a symbolic-link parent");

  const sourceBudget = await validateTree(webAppDist, "web-app/dist");
  const requiredSourceFiles = ["index.html", "manifest.webmanifest", "service-worker.js"];
  for (const pathname of requiredSourceFiles) {
    const stats = await lstat(resolve(webAppDist, pathname));
    invariant(stats.isFile() && !stats.isSymbolicLink(), `web-app/dist/${pathname} is missing`);
  }

  try {
    const destinationStats = await lstat(destination);
    invariant(
      !destinationStats.isSymbolicLink(),
      "website/dist/convert must not be a symbolic link",
    );
    invariant(destinationStats.isDirectory(), "website/dist/convert must be a directory");
    await validateTree(destination, "website/dist/convert", true);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const staging = await mkdtemp(resolve(websiteDist, ".convert-staging-"));
  invariant(isWithin(websiteDist, staging), "staging directory escaped website/dist");

  try {
    await copyTree(webAppDist, staging);
    const copiedBudget = await validateTree(staging, "staged Web app");
    invariant(
      copiedBudget.files === sourceBudget.files,
      "staged file count does not match the source",
    );
    invariant(
      copiedBudget.bytes === sourceBudget.bytes,
      "staged byte count does not match the source",
    );
    await rm(destination, { force: true, recursive: true });
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }

  return { bytes: sourceBudget.bytes, destination, files: sourceBudget.files };
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentFile === invokedFile) {
  const repositoryRoot = resolve(dirname(currentFile), "..");
  const result = await assembleWebRelease(repositoryRoot);
  process.stdout.write(
    `Assembled ${result.files} Web app files (${result.bytes} bytes) into website/dist/convert.\n`,
  );
}
