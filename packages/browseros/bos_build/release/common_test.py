#!/usr/bin/env python3
"""Tests for appcast item generation."""

import unittest

from ..core.products import get_product_descriptor
from .common import generate_appcast_item, get_download_path_mapping

ARTIFACT = {
    "url": "https://cdn.browseros.com/releases/0.31.0/win/BrowserOS_v0.31.0_x64_installer.exe",
    "sparkle_signature": "c2lnbmF0dXJl",
    "sparkle_length": 12345,
}


class GenerateAppcastItemTest(unittest.TestCase):
    def test_windows_item_has_os_attr_and_no_min_system_version(self):
        item = generate_appcast_item(
            ARTIFACT, "0.31.0", "7778.97", "2026-06-11T00:00:00Z", platform="win"
        )
        self.assertIn('sparkle:os="windows"', item)
        self.assertIn('sparkle:edSignature="c2lnbmF0dXJl"', item)
        self.assertIn('length="12345"', item)
        self.assertIn("<sparkle:version>7778.97</sparkle:version>", item)
        self.assertIn(
            "<sparkle:shortVersionString>0.31.0</sparkle:shortVersionString>", item
        )
        self.assertNotIn("minimumSystemVersion", item)

    def test_macos_item_unchanged_by_default(self):
        item = generate_appcast_item(
            ARTIFACT, "0.31.0", "7778.97", "2026-06-11T00:00:00Z"
        )
        self.assertIn(
            "<sparkle:minimumSystemVersion>10.15</sparkle:minimumSystemVersion>",
            item,
        )
        self.assertNotIn("sparkle:os=", item)


# Golden copy of the pre-productization DOWNLOAD_PATH_MAPPING constant —
# get_download_path_mapping(browseros) must stay byte-identical to it.
BROWSEROS_DOWNLOAD_GOLDEN = {
    "macos": {
        "arm64": "download/BrowserOS-arm64.dmg",
        "x64": "download/BrowserOS-x86_64.dmg",
        "universal": "download/BrowserOS.dmg",
    },
    "win": {
        "x64_installer": "download/BrowserOS_installer.exe",
    },
    "linux": {
        "x64_appimage": "download/BrowserOS.AppImage",
        "x64_deb": "download/BrowserOS.deb",
        "arm64_appimage": "download/BrowserOS-arm64.AppImage",
        "arm64_deb": "download/BrowserOS-arm64.deb",
    },
}

BROWSERCLAW_DOWNLOAD_GOLDEN = {
    "macos": {
        "arm64": "download/BrowserClaw-arm64.dmg",
        "x64": "download/BrowserClaw-x86_64.dmg",
        "universal": "download/BrowserClaw.dmg",
    },
    "win": {
        "x64_installer": "download/BrowserClaw_installer.exe",
    },
    "linux": {
        "x64_appimage": "download/BrowserClaw.AppImage",
        "x64_deb": "download/BrowserClaw.deb",
        "arm64_appimage": "download/BrowserClaw-arm64.AppImage",
        "arm64_deb": "download/BrowserClaw-arm64.deb",
    },
}


class DownloadPathMappingTest(unittest.TestCase):
    def test_browseros_mapping_matches_golden_constant(self):
        self.assertEqual(
            get_download_path_mapping(get_product_descriptor("browseros")),
            BROWSEROS_DOWNLOAD_GOLDEN,
        )

    def test_default_product_mapping_is_browseros(self):
        self.assertEqual(get_download_path_mapping(), BROWSEROS_DOWNLOAD_GOLDEN)

    def test_browserclaw_mapping_fully_prefixed(self):
        self.assertEqual(
            get_download_path_mapping(get_product_descriptor("browserclaw")),
            BROWSERCLAW_DOWNLOAD_GOLDEN,
        )


if __name__ == "__main__":
    unittest.main()
