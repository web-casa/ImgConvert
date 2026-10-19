# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 ImgConvert contributors
"""Reject false acceptance independently of the macOS window regressions."""

import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import check
import prepare


class CheckerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base = prepare.REPO / "apps/gpui/target/tmp"
        base.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix="ime-check-test-", dir=base)
        cls.addClassCleanup(cls.temp.cleanup)
        cls.stage = Path(cls.temp.name) / "candidate"
        cargo_home = Path(os.environ.get("CARGO_HOME", str(Path.home() / ".cargo")))
        cache = next(p for p in (cargo_home / "registry/cache").glob("*")
                     if all((p / f"{name}-0.3.8.crate").is_file()
                            for name in ["gpui-pre", "gpui-pre-macos"]))
        prepare.prepare(cache, cls.stage)
        metadata = subprocess.run(
            ["cargo", "metadata", "--offline", "--format-version", "1", "--manifest-path",
             str(cls.stage / "harness/Cargo.toml"), "--config", str(cls.stage / "candidate.toml")],
            capture_output=True, text=True, check=True,
        )
        cls.metadata = json.loads(metadata.stdout)

    def response(self, data):
        return subprocess.CompletedProcess(["cargo"], 0, json.dumps(data), "")

    def test_rejects_version_outside_product_lock(self):
        data = copy.deepcopy(self.metadata)
        next(p for p in data["packages"] if p["name"] == "gpui-base")["version"] = "0.7.2"
        with patch.object(check.subprocess, "run", return_value=self.response(data)) as run:
            with self.assertRaisesRegex(ValueError, "dependency outside the product lock"):
                check.check(self.stage, True)
            run.assert_called_once()

    def test_active_mode_rejects_accidentally_selected_staged_sources(self):
        with patch.object(check.subprocess, "run", return_value=self.response(self.metadata)):
            with self.assertRaisesRegex(ValueError, "unexpected source"):
                check.check(self.stage, True, active=True)

    def test_zero_tests_cannot_pass_native_acceptance(self):
        empty = subprocess.CompletedProcess(["cargo"], 0, "test result: ok. 0 passed; 0 failed;\n", "")
        with patch.object(check.sys, "platform", "darwin"):
            with patch.object(check.subprocess, "run", side_effect=[self.response(self.metadata), empty]):
                with self.assertRaisesRegex(ValueError, "expected all 13 macOS candidate tests"):
                    check.check(self.stage, False)

    def test_non_mac_full_run_is_refused(self):
        with patch.object(check.sys, "platform", "linux"):
            with patch.object(check.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "require macOS"):
                    check.check(self.stage, False)
                run.assert_not_called()

    def test_stale_test_copy_is_refused_before_cargo(self):
        fixture = self.stage / "harness/src/scheduling.rs"
        original = fixture.read_bytes()
        try:
            fixture.write_bytes(original + b"\n// stale\n")
            with patch.object(check.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "stale candidate test fixture"):
                    check.check(self.stage, True)
                run.assert_not_called()
        finally:
            fixture.write_bytes(original)

    def test_replaced_harness_wiring_is_refused_before_cargo(self):
        for relative in ["harness/src/lib.rs", "harness/Cargo.toml"]:
            fixture = self.stage / relative
            original = fixture.read_bytes()
            try:
                fixture.write_text("\n".join(f"#[test] fn unrelated_{i}() {{}}" for i in range(13)))
                with patch.object(check.subprocess, "run") as run:
                    with self.assertRaisesRegex(ValueError, "harness wiring differs"):
                        check.check(self.stage, True)
                    run.assert_not_called()
            finally:
                fixture.write_bytes(original)

    def test_thirteen_unrelated_tests_are_not_acceptance(self):
        output = "\n".join(f"test unrelated_{i} ... ok" for i in range(13))
        output += "\ntest result: ok. 13 passed; 0 failed;\n"
        unrelated = subprocess.CompletedProcess(["cargo"], 0, output, "")
        with patch.object(check.sys, "platform", "darwin"):
            with patch.object(check.subprocess, "run", side_effect=[self.response(self.metadata), unrelated]):
                with self.assertRaisesRegex(ValueError, "expected regression test identities"):
                    check.check(self.stage, False)


if __name__ == "__main__":
    unittest.main()
