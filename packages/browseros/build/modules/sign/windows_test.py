#!/usr/bin/env python3
"""Tests for Windows signing path discovery."""

import unittest
from pathlib import Path

from .windows import get_browseros_server_binary_paths


class WindowsSignPathsTest(unittest.TestCase):
    def test_browseros_and_claw_server_binaries_are_expected_for_signing(self):
        build_output_dir = Path("/tmp/out/Default")

        self.assertEqual(
            get_browseros_server_binary_paths(build_output_dir),
            [
                build_output_dir
                / "BrowserOSServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros_server.exe",
                build_output_dir
                / "BrowserOSClawServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros-claw-server.exe",
            ],
        )


if __name__ == "__main__":
    unittest.main()
