# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 ImgConvert contributors
"""Safety checks for staging the inactive candidate from Cargo's local cache."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import prepare
import verify


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.base = prepare.REPO / "apps/gpui/target/tmp"
        self.base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="ime-stage-test-", dir=self.base)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        cargo_home = Path(os.environ.get("CARGO_HOME", str(Path.home() / ".cargo")))
        self.cache = next(
            (p for p in (cargo_home / "registry/cache").glob("*")
             if all((p / f"{name}-{version}.crate").is_file()
                    for name, version in verify.VERSIONS.items())), None)
        if self.cache is None:
            self.fail("fetch the locked GPUI dependencies before running staging tests")
        self.product = [prepare.REPO / "apps/gpui" / p for p in ["Cargo.toml", "Cargo.lock"]]
        self.before = [p.read_bytes() for p in self.product]
        self.addCleanup(self.check_product_unchanged)

    def check_product_unchanged(self):
        self.assertEqual([p.read_bytes() for p in self.product], self.before)

    def test_prepares_config_without_activating_it(self):
        config = prepare.prepare(self.cache, self.directory / "candidate")
        self.assertTrue(config.is_file())
        self.assertIn("[patch.crates-io]", config.read_text())
        for name in ["gpui-pre", "gpui-pre-macos"]:
            self.assertTrue((config.parent / name / "Cargo.toml").is_file())
            self.assertTrue((config.parent / name / "LICENSE-APACHE").is_file())

    def test_unicode_config_is_accepted_by_cargo(self):
        config = prepare.prepare(self.cache, self.directory / "候选-😀")
        smoke = self.directory / "smoke"
        smoke.mkdir()
        manifest = smoke / "Cargo.toml"
        manifest.write_text('[package]\nname="ime-config-smoke"\nversion="0.0.0"\nedition="2024"\n[lib]\npath="lib.rs"\n[workspace]\n')
        (smoke / "lib.rs").write_text("")
        result = subprocess.run(
            ["cargo", "metadata", "--offline", "--no-deps", "--format-version", "1",
             "--manifest-path", str(manifest), "--config", str(config)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_refuses_to_replace_existing_output(self):
        marker = self.directory / "keep.txt"
        marker.write_text("existing evidence")
        with self.assertRaisesRegex(ValueError, "already exists"):
            prepare.prepare(self.cache, self.directory)
        self.assertEqual(marker.read_text(), "existing evidence")

    def test_refuses_output_outside_target_tmp(self):
        with self.assertRaisesRegex(ValueError, "below apps/gpui/target/tmp"):
            prepare.prepare(self.cache, prepare.REPO / "ime-candidate-outside-target")
        self.assertFalse((prepare.REPO / "ime-candidate-outside-target").exists())

    def test_rejects_bad_archive_before_creating_output(self):
        cache = self.directory / "cache"
        cache.mkdir()
        (cache / "gpui-pre-0.3.8.crate").write_bytes(b"corrupt archive")
        output = self.directory / "candidate"
        with self.assertRaisesRegex(ValueError, "archive checksum mismatch"):
            prepare.prepare(cache, output)
        self.assertFalse(output.exists())

    def test_failed_patch_cleans_only_its_new_output(self):
        marker = self.directory / "keep.txt"
        marker.write_text("existing evidence")
        output = self.directory / "candidate"
        with patch.object(prepare.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "git")):
            with self.assertRaises(subprocess.CalledProcessError):
                prepare.prepare(self.cache, output)
        self.assertFalse(output.exists())
        self.assertEqual(marker.read_text(), "existing evidence")

    def test_redirected_target_root_is_refused_by_preparer_and_checker(self):
        import check

        for component in ["target", "target/tmp"]:
            with self.subTest(component=component):
                fake_repo = self.directory / component.replace("/", "-")
                gpui = fake_repo / "apps/gpui"
                gpui.mkdir(parents=True)
                (gpui / "Cargo.lock").write_bytes(self.product[1].read_bytes())
                outside = self.directory / (component.replace("/", "-") + "-external")
                outside.mkdir()
                marker = outside / "keep.txt"
                marker.write_text("existing evidence")
                redirected = gpui / component
                redirected.parent.mkdir(parents=True, exist_ok=True)
                redirected.symlink_to(outside, target_is_directory=True)
                output = gpui / "target/tmp/candidate"
                with patch.object(prepare, "REPO", fake_repo):
                    with self.assertRaisesRegex(ValueError, "ownership root"):
                        prepare.prepare(self.cache, output)
                    with self.assertRaisesRegex(ValueError, "ownership root"):
                        check.check(output, True)
                self.assertFalse(output.exists())
                self.assertEqual(marker.read_text(), "existing evidence")


if __name__ == "__main__":
    unittest.main()
