#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 ImgConvert contributors
"""Stage verified crate archives and an opt-in config; never activate a patch."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
HARNESS_MANIFEST = (
    '[package]\nname="gpui-ime-focus-regression"\nversion="0.0.0"\n'
    'edition="2024"\nlicense="Apache-2.0"\npublish=false\n[workspace]\n'
    '[dev-dependencies]\ngpui-kit={version="=0.7.1",features=["test-support"]}\n'
    '[profile.release]\nlto="thin"\ncodegen-units=1\nstrip="debuginfo"\n'
)
HARNESS_ROOT = '#[cfg(test)]\n#[allow(dead_code)]\nmod controls;\n#[cfg(test)]\nmod scheduling;\n'


def owned_tmp():
    allowed = REPO / "apps/gpui/target/tmp"
    if allowed.resolve() != allowed:
        raise ValueError("apps/gpui/target/tmp ownership root must not be redirected by symlinks")
    return allowed


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def prepare(cache, output):
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    lock = REPO / "apps/gpui/Cargo.lock"
    if sha256(lock.read_bytes()) != manifest["workspace_lock_sha256"]:
        raise ValueError("workspace lock differs from the verified candidate matrix")
    allowed = owned_tmp()
    output = output.resolve()
    if not output.is_relative_to(allowed) or output == allowed:
        raise ValueError("output must be a new directory below apps/gpui/target/tmp")
    if output.exists():
        raise ValueError("output already exists; existing files will not be replaced")
    archives = {}
    for name, crate in manifest["crates"].items():
        archive = cache / f'{name}-{crate["version"]}.crate'
        data = archive.read_bytes()
        if sha256(data) != crate["archive_sha256"]:
            raise ValueError(f"archive checksum mismatch: {name}")
        patch = HERE / f"{name}.patch"
        if sha256(patch.read_bytes()) != crate["patch_sha256"]:
            raise ValueError(f"patch checksum mismatch: {name}")
        archives[name] = data
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir()  # Exclusive creation; never clean up a pre-existing output.
    try:
        config = ["[patch.crates-io]"]
        for name, crate in manifest["crates"].items():
            destination = output / name
            destination.mkdir()
            prefix = f'{name}-{crate["version"]}'
            with tarfile.open(fileobj=io.BytesIO(archives[name]), mode="r:gz") as archive:
                for member in archive:
                    path = PurePosixPath(member.name)
                    if not path.parts or path.is_absolute() or ".." in path.parts or path.parts[0] != prefix:
                        raise ValueError("unexpected archive member path")
                    target = destination.joinpath(*path.parts[1:])
                    if member.isdir():
                        target.mkdir(parents=True, exist_ok=True)
                    elif member.isfile() and target != destination:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with archive.extractfile(member) as source, target.open("xb") as sink:
                            shutil.copyfileobj(source, sink)
                        target.chmod(member.mode & 0o777)
                    else:
                        raise ValueError("unsupported archive member type")
            subprocess.run(
                ["git", "apply", "--unsafe-paths", f"--directory={destination}",
                 str(HERE / f"{name}.patch")],
                cwd=REPO, check=True,
            )
            for filename, expected in crate["patched_files"].items():
                if sha256((destination / filename).read_bytes()) != expected:
                    raise ValueError(f"patched source checksum mismatch: {name}/{filename}")
            config.append(f"{name} = {{ path = {json.dumps(str(destination), ensure_ascii=False)} }}")
        # A standalone Kit-only harness avoids changing product sources/locks.
        # Seed the lock conservatively; verify the resolved matrix before tests.
        harness = output / "harness"
        (harness / "src").mkdir(parents=True)
        (harness / "Cargo.toml").write_text(HARNESS_MANIFEST, encoding="utf-8")
        shutil.copyfile(lock, harness / "Cargo.lock")
        shutil.copyfile(REPO / "apps/gpui/crates/shell/examples/g2_ime_focus_regression.rs",
                        harness / "src/controls.rs")
        shutil.copyfile(HERE / "scheduling_tests.rs", harness / "src/scheduling.rs")
        (harness / "src/lib.rs").write_text(HARNESS_ROOT, encoding="utf-8")
        path = output / "candidate.toml"
        path.write_text("\n".join(config) + "\n", encoding="utf-8")
        return path
    except BaseException:
        shutil.rmtree(output)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-directory", type=Path, required=True,
                        help="Cargo registry/cache/<index> directory")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        config = prepare(args.cache_directory, args.output)
    except (OSError, ValueError, tarfile.TarError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Cannot prepare candidate: {error}\n")
    print(f"Prepared inactive candidate config: {config}")
    print("Use it only in a disposable checkout; no product manifest or lock was changed.")


if __name__ == "__main__":
    main()
