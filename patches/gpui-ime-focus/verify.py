#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 ImgConvert contributors
"""Verify the active, bounded source override and its frozen dependency matrix."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

import prepare

VENDOR = prepare.REPO / "apps/gpui/vendor"
VERSIONS = {"gpui-pre": "0.3.8", "gpui-pre-macos": "0.3.8", "gpui-base": "0.7.1"}
NAMES = set(VERSIONS)
KIT = {"gpui-kit", "gpui-base", "gpui-component", "gpui-kit-assets", "gpui-component-macros"}


def vendor_manifest(data):
    """Omit upstream example/test targets and prevent accidental publication."""
    text = data.decode("utf-8")
    text = re.sub(r'(?ms)^\[\[(?:example|test|bench)\]\]\n.*?(?=^\[|\Z)', '', text)
    return text.replace("publish = true", "publish = false").encode("utf-8")


def runtime_files(directory):
    for path in directory.rglob("*"):
        relative = path.relative_to(directory)
        if relative.parts[0] in {"src", "resources"} or str(relative) in {
            "Cargo.toml", "Cargo.toml.orig", "README.md", "LICENSE-APACHE", "build.rs"}:
            if path.is_file():
                data = path.read_bytes()
                yield relative.as_posix(), vendor_manifest(data) if str(relative) == "Cargo.toml" else data


def verify_sources():
    if VENDOR.resolve() != VENDOR:
        raise ValueError("source override root must not be redirected by symlinks")
    manifest = json.loads((prepare.HERE / "manifest.json").read_text(encoding="utf-8"))
    lock = (prepare.REPO / "apps/gpui/Cargo.lock").read_bytes()
    if prepare.sha256(lock) != manifest["workspace_lock_sha256"]:
        raise ValueError("active product lock differs from the verified matrix")
    # Prove that activation changed only the sources of the overridden crates.
    upstream = lock.decode("utf-8")
    for name in sorted(NAMES):
        crate = manifest["crates"][name]
        needle = f'name = "{name}"\nversion = "{crate["version"]}"\n'
        if upstream.count(needle) != 1:
            raise ValueError(f"ambiguous source override: {name}")
        upstream = upstream.replace(needle, needle +
            'source = "registry+https://github.com/rust-lang/crates.io-index"\n' +
            f'checksum = "{crate["archive_sha256"]}"\n')
    if prepare.sha256(upstream.encode("utf-8")) != manifest["upstream_lock_sha256"]:
        raise ValueError("activation changed dependencies beyond the reviewed source overrides")
    inventory = json.loads((prepare.HERE / "vendor-files.json").read_text(encoding="utf-8"))
    actual = {}
    for path in VENDOR.rglob("*"):
        if path.is_symlink():
            raise ValueError("source override must not contain symlinks")
        if path.is_file():
            actual[path.relative_to(VENDOR).as_posix()] = prepare.sha256(path.read_bytes())
    if actual != inventory:
        raise ValueError("source override inventory differs (missing, extra, or modified files)")
    if {Path(p).parts[0] for p in actual} != NAMES:
        raise ValueError("only the reviewed crates may be vendored")
    for name, crate in manifest["crates"].items():
        if prepare.sha256((prepare.HERE / f"{name}.patch").read_bytes()) != crate["patch_sha256"]:
            raise ValueError(f"patch checksum mismatch: {name}")
        for relative, digest in crate["patched_files"].items():
            if actual.get(f"{name}/{relative}") != digest:
                raise ValueError(f"active patch differs: {name}/{relative}")
    return inventory


def verify_metadata(data):
    paths = {f"imgconvert-gpui-{name}": prepare.REPO / f"apps/gpui/crates/{name}/Cargo.toml"
             for name in ["shared", "queue", "workflow", "preview", "diagnostics", "impact", "app-settings"]}
    paths["imgconvert-gpui"] = prepare.REPO / "apps/gpui/crates/shell/Cargo.toml"
    members = {p["name"] for p in data["packages"] if p["id"] in data["workspace_members"]}
    if members != set(paths):
        raise ValueError("source patches must not become workspace members")
    paths.update({f"imgconvert-{name}": prepare.REPO / f"crates/imgconvert-{name}/Cargo.toml"
                  for name in ["core", "platform", "backend"]})
    paths["arboard"] = prepare.REPO / "vendor/arboard/Cargo.toml"
    paths.update({name: VENDOR / name / "Cargo.toml" for name in NAMES})
    versions = {}
    for package in data["packages"]:
        name = package["name"]
        versions.setdefault(name, set()).add(package["version"])
        if package["source"] is None:
            if name not in paths or Path(package["manifest_path"]).resolve() != paths[name].resolve():
                raise ValueError(f"unreviewed path dependency: {name}")
        elif name in NAMES:
            raise ValueError(f"active override not selected: {name}")
    for name in KIT | NAMES:
        if versions.get(name) != {VERSIONS.get(name, "0.7.1")}:
            raise ValueError(f"wrong framework version matrix: {name}")


def verify_archives(cache):
    # The existing extractor verifies complete archive and patch checksums.
    directory = prepare.owned_tmp()
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ime-source-audit-", dir=directory) as temp:
        stage = Path(temp) / "candidate"
        prepare.prepare(cache, stage)
        expected = {f"{name}/{relative}": prepare.sha256(data)
                    for name in NAMES for relative, data in runtime_files(stage / name)}
        inventory = verify_sources()
        if expected != inventory:
            raise ValueError("vendored files differ from the verified archives plus reviewed patches")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", action="store_true")
    parser.add_argument("--archives", type=Path)
    args = parser.parse_args()
    try:
        inventory = verify_sources()
        if args.metadata:
            result = subprocess.run(["cargo", "metadata", "--locked", "--format-version", "1",
                                     "--manifest-path", str(prepare.REPO / "apps/gpui/Cargo.toml")],
                                    capture_output=True, text=True, check=True)
            verify_metadata(json.loads(result.stdout))
        if args.archives:
            verify_archives(args.archives)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"IME source verification failed: {error}\n")
    print(f"PASS: {len(inventory)} verified runtime/manifest/license files; {len(NAMES)} active overrides")


if __name__ == "__main__":
    main()
