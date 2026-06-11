#!/usr/bin/env python3
"""Tests for memory-aware ninja parallelism in the compile module."""

import unittest
from unittest import mock

from . import standard


class ComputeNinjaJobsTest(unittest.TestCase):
    def test_env_override_wins_on_any_platform(self):
        with mock.patch.object(standard, "IS_WINDOWS", return_value=False):
            jobs = standard.compute_ninja_jobs({"BROWSEROS_NINJA_JOBS": "24"})
        self.assertEqual(jobs, 24)

    def test_invalid_override_is_ignored(self):
        for bad in ("abc", "0", "-3", ""):
            with mock.patch.object(standard, "IS_WINDOWS", return_value=False):
                jobs = standard.compute_ninja_jobs({"BROWSEROS_NINJA_JOBS": bad})
            self.assertIsNone(jobs, f"override {bad!r} should be ignored")

    def test_non_windows_without_override_keeps_default(self):
        with mock.patch.object(standard, "IS_WINDOWS", return_value=False):
            self.assertIsNone(standard.compute_ninja_jobs({}))

    def test_windows_caps_jobs_by_physical_memory(self):
        with (
            mock.patch.object(standard, "IS_WINDOWS", return_value=True),
            mock.patch.object(
                standard, "_windows_total_memory_gb", return_value=64.0
            ),
            mock.patch("os.cpu_count", return_value=32),
        ):
            self.assertEqual(standard.compute_ninja_jobs({}), 16)

    def test_windows_clamps_to_cpu_count(self):
        with (
            mock.patch.object(standard, "IS_WINDOWS", return_value=True),
            mock.patch.object(
                standard, "_windows_total_memory_gb", return_value=256.0
            ),
            mock.patch("os.cpu_count", return_value=16),
        ):
            self.assertEqual(standard.compute_ninja_jobs({}), 16)

    def test_windows_never_returns_less_than_one_job(self):
        with (
            mock.patch.object(standard, "IS_WINDOWS", return_value=True),
            mock.patch.object(standard, "_windows_total_memory_gb", return_value=2.0),
            mock.patch("os.cpu_count", return_value=8),
        ):
            self.assertEqual(standard.compute_ninja_jobs({}), 1)

    def test_windows_memory_probe_failure_falls_back_to_default(self):
        with (
            mock.patch.object(standard, "IS_WINDOWS", return_value=True),
            mock.patch.object(standard, "_windows_total_memory_gb", return_value=None),
            mock.patch("os.cpu_count", return_value=32),
        ):
            self.assertIsNone(standard.compute_ninja_jobs({}))

    def test_windows_unknown_cpu_count_uses_memory_value(self):
        with (
            mock.patch.object(standard, "IS_WINDOWS", return_value=True),
            mock.patch.object(
                standard, "_windows_total_memory_gb", return_value=64.0
            ),
            mock.patch("os.cpu_count", return_value=None),
        ):
            self.assertEqual(standard.compute_ninja_jobs({}), 16)


if __name__ == "__main__":
    unittest.main()
