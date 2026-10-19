# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 ImgConvert contributors
"""Reject source/config drift independently of native composition regressions."""

import copy
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import prepare
import verify


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        base = prepare.owned_tmp()
        base.mkdir(parents=True, exist_ok=True)
        temp = tempfile.TemporaryDirectory(prefix="ime-vendor-test-", dir=base)
        self.addCleanup(temp.cleanup)
        self.directory = Path(temp.name)
        self.vendor = self.directory / "vendor"
        shutil.copytree(verify.VENDOR, self.vendor)
        override = patch.object(verify, "VENDOR", self.vendor)
        override.start()
        self.addCleanup(override.stop)

    def test_runtime_resource_drift_and_extra_files_are_rejected(self):
        resource = self.vendor / "gpui-pre/resources/windows/gpui.manifest.xml"
        original = resource.read_bytes()
        resource.write_bytes(original + b"\nmodified\n")
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            verify.verify_sources()
        resource.write_bytes(original)
        (self.vendor / "unexpected.txt").write_text("unreviewed")
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            verify.verify_sources()

    def test_symlinked_source_root_is_rejected(self):
        redirect = self.directory / "redirect"
        redirect.symlink_to(self.vendor, target_is_directory=True)
        with patch.object(verify, "VENDOR", redirect):
            with self.assertRaisesRegex(ValueError, "redirected by symlinks"):
                verify.verify_sources()

    def test_archive_audit_can_create_its_owned_temporary_root(self):
        cargo_home = Path(os.environ.get("CARGO_HOME", str(Path.home() / ".cargo")))
        cache = next(p for p in (cargo_home / "registry/cache").glob("*")
                     if all((p / f"{name}-0.3.8.crate").is_file() for name in verify.NAMES))
        directory = self.directory / "new-target/tmp"
        with patch.object(prepare, "owned_tmp", return_value=directory):
            verify.verify_archives(cache)
        self.assertEqual(list(directory.iterdir()), [])

    def test_normalized_tree_matches_reviewed_inventory(self):
        inventory = verify.verify_sources()
        self.assertEqual(set(inventory), {
            f"{name}/{relative}" for name in verify.NAMES
            for relative, _ in verify.runtime_files(self.vendor / name)})

    def test_metadata_rejects_registry_fallback_and_wrong_path(self):
        names = {"shell": "imgconvert-gpui", **{
            n: f"imgconvert-gpui-{n}" for n in
            ["shared", "queue", "workflow", "preview", "diagnostics", "impact", "app-settings"]}}
        packages = [{"id": name, "name": name, "version": "0.4.0-poc.1", "source": None,
                     "manifest_path": str(prepare.REPO / f"apps/gpui/crates/{folder}/Cargo.toml")}
                    for folder, name in names.items()]
        members = [p["id"] for p in packages]
        packages += [{"id": name, "name": name, "version": "0.3.8", "source": None,
                      "manifest_path": str(self.vendor / name / "Cargo.toml")} for name in verify.NAMES]
        packages += [{"id": name, "name": name, "version": "0.7.1", "source": "registry+test",
                      "manifest_path": "unused"} for name in verify.KIT]
        data = {"packages": packages, "workspace_members": members}
        verify.verify_metadata(data)
        fallback = copy.deepcopy(data)
        next(p for p in fallback["packages"] if p["name"] == "gpui-pre")["source"] = "registry+test"
        with self.assertRaisesRegex(ValueError, "override not selected"):
            verify.verify_metadata(fallback)
        wrong = copy.deepcopy(data)
        next(p for p in wrong["packages"] if p["name"] == "gpui-pre")["manifest_path"] = str(self.directory / "other/Cargo.toml")
        with self.assertRaisesRegex(ValueError, "unreviewed path"):
            verify.verify_metadata(wrong)


if __name__ == "__main__":
    unittest.main()
