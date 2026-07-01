#!/usr/bin/env python3
"""BrowserClaw — the browser for web agents."""

from pathlib import Path

from ...core.products import ProductDescriptor
from ...core.server_binaries import ServerBundle, SignSpec

BROWSERCLAW_PRODUCT = ProductDescriptor.define(
    id="browserclaw",
    display_name="BrowserClaw",
    windows_installer_guid="{FA2AFFF8-647B-477C-A5D2-905BA8DB9B82}",
    summary="The open source browser for web agents",
    description="BrowserClaw is a Chromium-based browser for agent workflows.",
)

BROWSERCLAW_SERVER_BUNDLE = ServerBundle(
    id="browserclaw-server",
    name="BrowserOS Claw Server",
    product_ids=("browserclaw",),
    chromium_output_root="BrowserClawServer",
    local_resources_root=Path("resources/binaries/browseros_claw_server"),
    chromium_resources_root=Path("chrome/browser/browseros/claw_server/resources"),
    macos_bundle_resources_root=Path(
        "Contents/Resources/BrowserClawServer/default/resources"
    ),
    windows_bundle_resources_root=Path("BrowserClawServer/default/resources"),
    macos_binaries={
        "browseros-claw-server": SignSpec(
            "browseros_claw_server",
            "runtime",
            "browseros-executable-entitlements.plist",
        ),
    },
    windows_binaries=("browseros-claw-server.exe",),
    required_in_chromium_output=False,
)
