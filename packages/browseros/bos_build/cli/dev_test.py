#!/usr/bin/env python3
"""CLI surface tests for the dev subcommands."""

import json
import unittest
from unittest import mock

import yaml
from typer.testing import CliRunner

from bos_build.browseros import app

runner = CliRunner()


def invoke(*args: str):
    return runner.invoke(app, ["dev", *args])


def combined(result) -> str:
    """stdout + stderr across click versions (8.2 split them)."""
    out = result.output
    try:
        out += result.stderr
    except (ValueError, AttributeError):
        pass
    return out


class DevHelpTest(unittest.TestCase):
    def test_dev_help_lists_extract_and_doctor(self):
        result = invoke("--help")

        self.assertEqual(result.exit_code, 0, combined(result))
        self.assertIn("extract", result.output)
        self.assertIn("doctor", result.output)


class DoctorCliTest(unittest.TestCase):
    def test_help_documents_flags_and_read_only_guarantee(self):
        result = invoke("doctor", "--help")

        self.assertEqual(result.exit_code, 0, combined(result))
        for flag in ("--against", "--feature", "--json"):
            self.assertIn(flag, result.output)
        self.assertIn("read-only", result.output.lower())

    def test_json_report_has_stable_shape_and_matching_exit_code(self):
        result = invoke("doctor", "--json")

        report = json.loads(result.output)
        self.assertEqual(
            set(report), {"root", "feature", "repo", "apply", "healthy"}
        )
        self.assertEqual(
            set(report["repo"]),
            {"patches", "features", "errors", "warnings", "findings"},
        )
        self.assertIsNone(report["apply"])
        self.assertIsNone(report["feature"])
        self.assertEqual(result.exit_code, 0 if report["healthy"] else 1)

    def test_unknown_feature_is_a_usage_error(self):
        result = invoke("doctor", "--feature", "definitely-not-a-feature")

        self.assertEqual(result.exit_code, 2, combined(result))
        self.assertIn("unknown feature", combined(result))

    def test_broken_features_yaml_is_a_clean_usage_error(self):
        with mock.patch(
            "bos_build.patchkit.doctor.load_features",
            side_effect=yaml.YAMLError("features.yaml is broken"),
        ):
            result = invoke("doctor")

        self.assertEqual(result.exit_code, 2, combined(result))
        self.assertIn("features.yaml is broken", combined(result))


if __name__ == "__main__":
    unittest.main()
