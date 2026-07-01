#!/usr/bin/env python3
"""Version file parsing and derivation for the build context.

Three inputs live in the repo:
- CHROMIUM_VERSION (MAJOR=/MINOR=/BUILD=/PATCH=): the chromium pin
- bos_build/config/BROWSEROS_BUILD_OFFSET: added to chromium BUILD to
  produce the browseros chromium version (keeps our build numbers above
  upstream's for update ordering)
- resources/BROWSEROS_VERSION: the semantic product version
"""

from pathlib import Path
from typing import Dict, Tuple

from .utils import join_paths


def load_chromium_version(root_dir: Path) -> Tuple[str, Dict[str, str]]:
    """Parse CHROMIUM_VERSION into ("MAJOR.MINOR.BUILD.PATCH", parts)."""
    version_dict: Dict[str, str] = {}
    version_file = join_paths(root_dir, "CHROMIUM_VERSION")

    if version_file.exists():
        for line in version_file.read_text().strip().split("\n"):
            key, value = line.split("=")
            version_dict[key] = value

        chromium_version = (
            f"{version_dict['MAJOR']}.{version_dict['MINOR']}."
            f"{version_dict['BUILD']}.{version_dict['PATCH']}"
        )
        return chromium_version, version_dict

    return "", version_dict


def load_build_offset(root_dir: Path) -> str:
    """Read bos_build/config/BROWSEROS_BUILD_OFFSET."""
    version_file = join_paths(root_dir, "bos_build", "config", "BROWSEROS_BUILD_OFFSET")
    if version_file.exists():
        return version_file.read_text().strip()
    return ""


def load_semantic_version(root_dir: Path) -> str:
    """Read resources/BROWSEROS_VERSION into e.g. "0.31.0".

    PATCH is only included when non-zero; a zero BUILD renders as ".0".
    """
    version_file = join_paths(root_dir, "resources", "BROWSEROS_VERSION")
    if not version_file.exists():
        return ""

    version_dict = {}
    for line in version_file.read_text().strip().split("\n"):
        line = line.strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        version_dict[key.strip()] = value.strip()

    major = version_dict.get("BROWSEROS_MAJOR", "0")
    minor = version_dict.get("BROWSEROS_MINOR", "0")
    build = version_dict.get("BROWSEROS_BUILD", "0")
    patch = version_dict.get("BROWSEROS_PATCH", "0")

    if patch != "0":
        return f"{major}.{minor}.{build}.{patch}"
    elif build != "0":
        return f"{major}.{minor}.{build}"
    else:
        return f"{major}.{minor}.0"


def derive_browseros_chromium_version(
    version_dict: Dict[str, str], build_offset: str
) -> str:
    """chromium version with BUILD shifted by the browseros offset."""
    if not version_dict or not build_offset:
        return ""
    new_build = int(version_dict["BUILD"]) + int(build_offset)
    return (
        f"{version_dict['MAJOR']}.{version_dict['MINOR']}."
        f"{new_build}.{version_dict['PATCH']}"
    )


def sparkle_version_from(browseros_chromium_version: str) -> str:
    """Sparkle compares BUILD.PATCH — e.g. "7231.69"."""
    if not browseros_chromium_version:
        raise ValueError("browseros_chromium_version is not set")

    parts = browseros_chromium_version.split(".")
    if len(parts) < 4:
        raise ValueError(
            f"Invalid browseros_chromium_version format: {browseros_chromium_version}"
        )
    return f"{parts[2]}.{parts[3]}"
