#!/usr/bin/env python3
"""Tests for version parsing and derivation."""

import tempfile
import unittest
from pathlib import Path

from bos_build.core import versions


class VersionsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def test_chromium_version_parses_pin_file(self):
        (self.root / "CHROMIUM_VERSION").write_text(
            "MAJOR=148\nMINOR=0\nBUILD=7402\nPATCH=57\n"
        )
        version, parts = versions.load_chromium_version(self.root)
        self.assertEqual(version, "148.0.7402.57")
        self.assertEqual(parts["BUILD"], "7402")

    def test_chromium_version_missing_file_is_empty(self):
        self.assertEqual(versions.load_chromium_version(self.root), ("", {}))

    def test_build_offset(self):
        offset_file = self.root / "bos_build" / "config" / "BROWSEROS_BUILD_OFFSET"
        offset_file.parent.mkdir(parents=True)
        offset_file.write_text("80\n")
        self.assertEqual(versions.load_build_offset(self.root), "80")

    def test_semantic_version_patch_only_when_nonzero(self):
        res = self.root / "resources"
        res.mkdir()
        f = res / "BROWSEROS_VERSION"

        f.write_text(
            "BROWSEROS_MAJOR=0\nBROWSEROS_MINOR=31\nBROWSEROS_BUILD=0\nBROWSEROS_PATCH=0\n"
        )
        self.assertEqual(versions.load_semantic_version(self.root), "0.31.0")

        f.write_text(
            "BROWSEROS_MAJOR=0\nBROWSEROS_MINOR=31\nBROWSEROS_BUILD=2\nBROWSEROS_PATCH=0\n"
        )
        self.assertEqual(versions.load_semantic_version(self.root), "0.31.2")

        f.write_text(
            "BROWSEROS_MAJOR=0\nBROWSEROS_MINOR=31\nBROWSEROS_BUILD=2\nBROWSEROS_PATCH=5\n"
        )
        self.assertEqual(versions.load_semantic_version(self.root), "0.31.2.5")

    def test_browseros_chromium_version_adds_offset_to_build(self):
        parts = {"MAJOR": "148", "MINOR": "0", "BUILD": "7402", "PATCH": "57"}
        self.assertEqual(
            versions.derive_browseros_chromium_version(parts, "80"),
            "148.0.7482.57",
        )
        self.assertEqual(versions.derive_browseros_chromium_version({}, "80"), "")
        self.assertEqual(versions.derive_browseros_chromium_version(parts, ""), "")

    def test_sparkle_version_is_build_dot_patch(self):
        self.assertEqual(versions.sparkle_version_from("148.0.7482.57"), "7482.57")
        with self.assertRaises(ValueError):
            versions.sparkle_version_from("")
        with self.assertRaises(ValueError):
            versions.sparkle_version_from("1.2.3")


if __name__ == "__main__":
    unittest.main()
