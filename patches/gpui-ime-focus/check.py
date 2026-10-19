#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 ImgConvert contributors
"""Verify the standalone candidate matrix, then run explicit macOS regressions."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

import prepare


def check(stage, metadata_only):
    stage = stage.resolve()
    allowed = prepare.owned_tmp()
    if stage == allowed or not stage.is_relative_to(allowed):
        raise ValueError("candidate must be below apps/gpui/target/tmp")
    if sys.platform != "darwin" and not metadata_only:
        raise ValueError("native candidate regressions require macOS; metadata-only proves no native behavior")
    manifest = json.loads((prepare.HERE / "manifest.json").read_text(encoding="utf-8"))
    lock = prepare.REPO / "apps/gpui/Cargo.lock"
    if prepare.sha256(lock.read_bytes()) != manifest["workspace_lock_sha256"]:
        raise ValueError("product lock differs from the verified matrix")
    for name, crate in manifest["crates"].items():
        for filename, digest in crate["patched_files"].items():
            if prepare.sha256((stage / name / filename).read_bytes()) != digest:
                raise ValueError(f"candidate source differs: {name}/{filename}")
    fixtures = {
        stage / "harness/src/controls.rs": prepare.REPO / "apps/gpui/crates/shell/examples/g2_ime_focus_regression.rs",
        stage / "harness/src/scheduling.rs": prepare.HERE / "scheduling_tests.rs",
    }
    for staged, source in fixtures.items():
        if staged.read_bytes() != source.read_bytes():
            raise ValueError(f"stale candidate test fixture: {staged.name}")
    for relative, expected in {
        "harness/Cargo.toml": prepare.HARNESS_MANIFEST,
        "harness/src/lib.rs": prepare.HARNESS_ROOT,
    }.items():
        if (stage / relative).read_text(encoding="utf-8") != expected:
            raise ValueError(f"candidate harness wiring differs: {relative}")
    expected_tests = set()
    for staged in fixtures:
        prefix = "controls::regression::" if staged.name == "controls.rs" else "scheduling::"
        names = re.findall(r'#\[gpui_kit::test\]\s*fn (\w+)\(', staged.read_text(encoding="utf-8"))
        expected_tests.update(prefix + name for name in names)
    if len(expected_tests) != 13:
        raise ValueError("expected 13 named regression fixtures")
    harness = stage / "harness/Cargo.toml"
    common = ["--manifest-path", str(harness), "--config", str(stage / "candidate.toml"), "--offline"]
    resolved = subprocess.run(["cargo", "metadata", *common, "--format-version", "1"],
                              capture_output=True, text=True, check=True)
    data = json.loads(resolved.stdout)
    # Cargo-generated lock blocks use plain quoted name/version strings.
    locked = set()
    for block in lock.read_text(encoding="utf-8").split("[[package]]")[1:]:
        name = re.search(r'^name = "([^"]+)"$', block, re.MULTILINE)
        version = re.search(r'^version = "([^"]+)"$', block, re.MULTILINE)
        source = re.search(r'^source = "([^"]+)"$', block, re.MULTILINE)
        if name and version:
            locked.add((name[1], version[1], source[1] if source else None))
    versions = {}
    for package in data["packages"]:
        name, version, source = package["name"], package["version"], package["source"]
        versions.setdefault(name, set()).add(version)
        if name == "gpui-ime-focus-regression":
            expected = harness
        elif name in manifest["crates"]:
            expected = stage / name / "Cargo.toml"
        else:
            if source is None:
                raise ValueError(f"unexpected additional path dependency: {name}")
            if (name, version, source) not in locked:
                raise ValueError(f"dependency outside the product lock: {name} {version}")
            continue
        if Path(package["manifest_path"]).resolve() != expected.resolve():
            raise ValueError(f"unexpected source for {name}")
    for name in ["gpui-kit", "gpui-base", "gpui-component", "gpui-kit-assets", "gpui-component-macros"]:
        if versions.get(name) != {"0.7.1"}:
            raise ValueError(f"wrong Kit matrix: {name} {versions.get(name)}")
    for name in ["gpui-pre", "gpui-pre-macos"]:
        if versions.get(name) != {"0.3.8"}:
            raise ValueError(f"wrong GPUI matrix: {name} {versions.get(name)}")
    (stage / "verified-matrix.json").write_text(
        json.dumps({name: sorted(value) for name, value in versions.items()}, indent=2) + "\n",
        encoding="utf-8",
    )
    print("PASS: candidate dependencies match the product lock; Kit 0.7.1 / GPUI 0.3.8", flush=True)
    if metadata_only:
        print("Metadata only: no native or headless tests were run.", flush=True)
        return
    # Initial metadata resolution changed only the harness lock. Tests now lock it.
    result = subprocess.run(["cargo", "test", *common, "--locked", "--release", "--lib", "-j1"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (stage / "tests.log").write_text(result.stdout, encoding="utf-8")
    print(result.stdout)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, result.args)
    if not re.search(r'test result: ok\. 13 passed; 0 failed;', result.stdout):
        raise ValueError("expected all 13 macOS candidate tests; zero tests is not acceptance")
    passed_tests = re.findall(r'^test (\S+) \.\.\. ok$', result.stdout, re.MULTILINE)
    if len(passed_tests) != 13 or set(passed_tests) != expected_tests:
        raise ValueError("candidate did not run the expected regression test identities")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--metadata-only", action="store_true")
    args = parser.parse_args()
    try:
        check(args.candidate, args.metadata_only)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Candidate verification failed: {error}\n")


if __name__ == "__main__":
    main()
