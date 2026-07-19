#!/usr/bin/env python3
"""OWeb Browser — branded BrowserOS product for the OWeb workspace."""

from pathlib import Path

from ...core.products import (
    BROWSEROS_AGENT_EXTENSION_ID,
    BROWSEROS_BUG_REPORTER_EXTENSION_ID,
    MacProductIdentity,
    ProductDescriptor,
)
from ..server_binaries import ServerBundle, SignSpec

OWEB_PRODUCT = ProductDescriptor.define(
    id="oweb",
    display_name="OWeb Browser",
    windows_installer_guid="{A7E3C4F1-9B2D-4E8A-8C5F-1D6E9A0B3C72}",
    summary="The AI browser for your OWeb workspace",
    description=(
        "OWeb Browser is a privacy-focused Chromium browser with a built-in AI agent "
        "connected to your OWeb account, credits, and integrations."
    ),
    mac_bundle_domain="com.oweb",
    company="OWeb",
    homepage_url="https://oweb.one/",
    support_url="https://oweb.one/docs",
    bugtracker_url="https://github.com/SalesflowOne/BrowserOS/issues",
    app_base_name="OWebBrowser",
    artifact_prefix="OWebBrowser",
    release_prefix="oweb",
    installer_full_name="OWeb Browser Installer",
    dev_installer_full_name="OWeb Browser Dev Installer",
    mac=MacProductIdentity(
        bundle_id="com.oweb.OWebBrowser",
        dev_bundle_id="com.oweb.dev.OWebBrowser",
        signing_identifier="com.oweb.OWebBrowser",
        dev_signing_identifier="com.oweb.dev.OWebBrowser",
        framework_name="OWeb Browser Framework.framework",
        dev_framework_name="OWeb Browser Dev Framework.framework",
        dmg_volume_name="OWeb Browser",
    ),
    required_extensions=(
        (BROWSEROS_AGENT_EXTENSION_ID, "OWeb Browser agent"),
        (BROWSEROS_BUG_REPORTER_EXTENSION_ID, "OWeb Browser bug reporter"),
    ),
    string_replacements=(
        (
            r"The Chromium Authors. All rights reserved.",
            "OWeb. All rights reserved.",
        ),
        (
            r"Google LLC. All rights reserved.",
            "OWeb. All rights reserved.",
        ),
        (r"The Chromium Authors", "OWeb Software Inc"),
        (r"Google Chrome", "OWeb Browser"),
        (r"BrowserOS", "OWeb Browser"),
        (r"(Google)(?! Play)", "OWeb"),
        (r"Chromium", "OWeb Browser"),
        (r"Chrome", "OWeb Browser"),
    ),
)

OWEB_SERVER_BUNDLE = ServerBundle(
    id="oweb-server",
    name="OWeb Browser Server",
    product_ids=("oweb",),
    chromium_output_root="OWebServer",
    local_resources_root=Path("resources/binaries/oweb_server"),
    chromium_resources_root=Path("chrome/browser/browseros/server/resources"),
    macos_bundle_resources_root=Path(
        "Contents/Resources/OWebServer/default/resources"
    ),
    windows_bundle_resources_root=Path("OWebServer/default/resources"),
    macos_binaries={
        "browseros_server": SignSpec(
            "browseros_server", "runtime", "browseros-executable-entitlements.plist"
        ),
        "bun": SignSpec("bun", "runtime", "browseros-executable-entitlements.plist"),
        "rg": SignSpec("rg", "runtime"),
    },
    windows_binaries=("browseros_server.exe",),
)
