#!/usr/bin/env python3
"""Tests for the patch-stack doctor."""

import tempfile
import unittest
from pathlib import Path
from typing import Dict, List

from bos_build.patchkit.doctor import (
    check_repo,
    compute_claims,
    patch_base_paths,
)


def _patches_dir(files: List[str]) -> Path:
    root = Path(tempfile.mkdtemp()) / "chromium_patches"
    for rel in files:
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("diff")
    return root


def _feature(files: List[str], description: str = "feat: test feature") -> Dict:
    return {"description": description, "files": files}


class PatchBasePathsTest(unittest.TestCase):
    def test_markers_map_to_base_and_dotfiles_skipped(self):
        patches = _patches_dir(
            [
                "chrome/a.cc",
                "chrome/b.cc.deleted",
                "chrome/c.mm.binary",
                "chrome/d.h.rename",
                "chrome/.gitignore",
            ]
        )
        self.assertEqual(
            patch_base_paths(patches),
            {"chrome/a.cc", "chrome/b.cc", "chrome/c.mm", "chrome/d.h"},
        )

    def test_missing_dir_is_empty(self):
        self.assertEqual(patch_base_paths(Path("/nonexistent/patches")), set())


class EntryResolutionTest(unittest.TestCase):
    def test_clean_tree_has_no_findings(self):
        patches = _patches_dir(["chrome/a.cc", "third_party/lib/x.gn"])
        features = {
            "one": _feature(["chrome/a.cc"]),
            "two": _feature(["third_party/lib/"]),
        }
        self.assertEqual(check_repo(features, patches), [])

    def test_missing_file_entry_reported_with_feature_and_path(self):
        patches = _patches_dir(["chrome/a.cc"])
        features = {"one": _feature(["chrome/a.cc", "chrome/gone.cc"])}
        findings = check_repo(features, patches)
        self.assertEqual(len(findings), 1)
        f = findings[0]
        self.assertEqual(
            (f.check, f.severity, f.feature, f.path),
            ("missing-patch", "error", "one", "chrome/gone.cc"),
        )

    def test_marker_variants_resolve_file_entries(self):
        patches = _patches_dir(
            ["chrome/a.cc.deleted", "chrome/b.mm.binary", "chrome/c.h.rename"]
        )
        features = {
            "one": _feature(["chrome/a.cc", "chrome/b.mm", "chrome/c.h"]),
        }
        self.assertEqual(check_repo(features, patches), [])

    def test_empty_directory_entry_reported(self):
        patches = _patches_dir(["chrome/a.cc"])
        features = {
            "one": _feature(["chrome/a.cc"]),
            "two": _feature(["third_party/lib/"]),
        }
        findings = check_repo(features, patches)
        self.assertEqual(len(findings), 1)
        f = findings[0]
        self.assertEqual(
            (f.check, f.severity, f.feature, f.path),
            ("empty-dir", "error", "two", "third_party/lib/"),
        )

    def test_directory_prefix_does_not_match_sibling(self):
        patches = _patches_dir(["chrome/subfoo/a.cc"])
        features = {
            "one": _feature(["chrome/sub/"]),
            "two": _feature(["chrome/subfoo/a.cc"]),
        }
        findings = check_repo(features, patches)
        self.assertEqual([f.check for f in findings], ["empty-dir"])
        self.assertEqual(findings[0].feature, "one")


class ClassificationTest(unittest.TestCase):
    def test_unclassified_patch_reported(self):
        patches = _patches_dir(["chrome/a.cc", "chrome/orphan.cc"])
        features = {"one": _feature(["chrome/a.cc"])}
        findings = check_repo(features, patches)
        self.assertEqual(len(findings), 1)
        f = findings[0]
        self.assertEqual(
            (f.check, f.severity, f.feature, f.path),
            ("unclassified", "error", None, "chrome/orphan.cc"),
        )

    def test_unclaimed_marker_reported_under_base_path(self):
        patches = _patches_dir(["chrome/gone.cc.deleted"])
        findings = check_repo({}, patches)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].check, "unclassified")
        self.assertEqual(findings[0].path, "chrome/gone.cc")

    def test_multi_file_claim_is_warning_naming_all_claimants(self):
        patches = _patches_dir(["chrome/a.cc"])
        features = {
            "one": _feature(["chrome/a.cc"]),
            "two": _feature(["chrome/a.cc"]),
        }
        findings = check_repo(features, patches)
        self.assertEqual(len(findings), 1)
        f = findings[0]
        self.assertEqual((f.check, f.severity, f.path), ("multi-claim", "warning", "chrome/a.cc"))
        self.assertIn("one", f.message)
        self.assertIn("two", f.message)

    def test_dir_and_file_entry_overlap_is_multi_claim(self):
        patches = _patches_dir(["chrome/sub/a.cc"])
        features = {
            "one": _feature(["chrome/sub/"]),
            "two": _feature(["chrome/sub/a.cc"]),
        }
        findings = check_repo(features, patches)
        self.assertEqual([f.check for f in findings], ["multi-claim"])

    def test_same_feature_claiming_via_file_and_dir_is_not_multi_claim(self):
        patches = _patches_dir(["chrome/sub/a.cc"])
        features = {"one": _feature(["chrome/sub/", "chrome/sub/a.cc"])}
        self.assertEqual(check_repo(features, patches), [])


class SeriesExemptionTest(unittest.TestCase):
    def test_series_feature_entries_do_not_need_patches(self):
        patches = _patches_dir(["chrome/a.cc"])
        features = {
            "one": _feature(["chrome/a.cc"]),
            "win": _feature(
                ["build/config.h", "chrome/app/x.rc"],
                description="series: windows platform patches",
            ),
        }
        self.assertEqual(check_repo(features, patches), [])

    def test_series_feature_does_not_claim_disk_patches(self):
        patches = _patches_dir(["chrome/a.cc"])
        features = {
            "win": _feature(["chrome/a.cc"], description="series: windows"),
        }
        findings = check_repo(features, patches)
        self.assertEqual([f.check for f in findings], ["unclassified"])


class FeatureMetadataTest(unittest.TestCase):
    def test_invalid_name_and_description_reported(self):
        patches = _patches_dir(["chrome/a.cc"])
        features = {
            "Bad Name": _feature(["chrome/a.cc"]),
            "two": _feature([], description="no prefix here"),
        }
        findings = check_repo(features, patches)
        checks = [(f.check, f.feature) for f in findings if f.check == "invalid-feature"]
        self.assertIn(("invalid-feature", "Bad Name"), checks)
        self.assertIn(("invalid-feature", "two"), checks)

    def test_series_features_still_get_metadata_checks(self):
        patches = _patches_dir([])
        features = {"BAD": _feature([], description="series: x")}
        findings = check_repo(features, patches)
        self.assertEqual([f.check for f in findings], ["invalid-feature"])


class FeatureFilterTest(unittest.TestCase):
    def _fixture(self):
        patches = _patches_dir(["chrome/a.cc", "chrome/orphan.cc"])
        features = {
            "one": _feature(["chrome/a.cc", "chrome/gone1.cc"]),
            "two": _feature(["chrome/a.cc", "chrome/gone2.cc"]),
        }
        return features, patches

    def test_filter_keeps_only_that_features_findings(self):
        features, patches = self._fixture()
        findings = check_repo(features, patches, feature="one")
        self.assertEqual(
            [(f.check, f.feature, f.path) for f in findings],
            [
                ("missing-patch", "one", "chrome/gone1.cc"),
                ("multi-claim", None, "chrome/a.cc"),
            ],
        )

    def test_filter_drops_unclassified(self):
        features, patches = self._fixture()
        findings = check_repo(features, patches, feature="two")
        self.assertNotIn("unclassified", [f.check for f in findings])

    def test_unknown_feature_raises(self):
        features, patches = self._fixture()
        with self.assertRaises(ValueError):
            check_repo(features, patches, feature="nope")

    def test_findings_sorted_deterministically(self):
        patches = _patches_dir([])
        features = {
            "zed": _feature(["chrome/z.cc"]),
            "abc": _feature(["chrome/b.cc", "chrome/a.cc"]),
        }
        findings = check_repo(features, patches)
        self.assertEqual(
            [(f.feature, f.path) for f in findings],
            [
                ("abc", "chrome/a.cc"),
                ("abc", "chrome/b.cc"),
                ("zed", "chrome/z.cc"),
            ],
        )


class ComputeClaimsTest(unittest.TestCase):
    def test_claims_are_sorted_and_deduplicated(self):
        patches = _patches_dir(["chrome/sub/a.cc"])
        bases = patch_base_paths(patches)
        features = {
            "zed": _feature(["chrome/sub/"]),
            "abc": _feature(["chrome/sub/a.cc", "chrome/sub/"]),
        }
        self.assertEqual(
            compute_claims(features, bases), {"chrome/sub/a.cc": ["abc", "zed"]}
        )


if __name__ == "__main__":
    unittest.main()
