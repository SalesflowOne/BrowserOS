#!/usr/bin/env python3
"""Patch-stack doctor: read-only health checks for features.yaml ↔ chromium_patches/.

Answers "how healthy is the patch stack" without touching any tree:
repo-local consistency (every features.yaml entry resolves to a patch,
every patch is claimed, claims don't overlap) plus an optional dry-run
apply report against a chromium checkout. Pure functions returning
findings — callers render and decide exit codes.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set

from .validation import validate_description, validate_feature_name

MARKER_SUFFIXES = (".deleted", ".binary", ".rename")

# Features whose description carries this prefix list files touched by
# series_patches/ quilt patches, not chromium_patches/ paths — they are
# exempt from patch-resolution checks and never claim on-disk patches.
SERIES_PREFIX = "series:"

UNCLASSIFIED = "(unclassified)"


@dataclass(frozen=True)
class Finding:
    check: str  # missing-patch | empty-dir | unclassified | multi-claim | invalid-feature
    severity: str  # error | warning
    message: str
    feature: Optional[str] = None
    path: Optional[str] = None


def is_series_feature(spec: Dict) -> bool:
    return str(spec.get("description") or "").startswith(SERIES_PREFIX)


def patch_base_paths(patches_dir: Path) -> Set[str]:
    """Relative paths of all patches on disk, markers mapped to their base path."""
    bases: Set[str] = set()
    if not patches_dir.exists():
        return bases
    for path in patches_dir.rglob("*"):
        if not path.is_file() or path.name.startswith("."):
            continue
        rel = path.relative_to(patches_dir).as_posix()
        for suffix in MARKER_SUFFIXES:
            if rel.endswith(suffix):
                rel = rel[: -len(suffix)]
                break
        bases.add(rel)
    return bases


def compute_claims(features: Dict, bases: Set[str]) -> Dict[str, List[str]]:
    """Map each on-disk base path to the sorted features claiming it."""
    claims: Dict[str, Set[str]] = {base: set() for base in bases}
    for name, spec in features.items():
        if is_series_feature(spec):
            continue
        for entry in spec.get("files") or []:
            if entry.endswith("/"):
                for base in bases:
                    if base.startswith(entry):
                        claims[base].add(name)
            elif entry in claims:
                claims[entry].add(name)
    return {base: sorted(owners) for base, owners in claims.items()}


def check_feature_metadata(
    features: Dict, feature: Optional[str] = None
) -> List[Finding]:
    findings = []
    for name, spec in features.items():
        if feature is not None and name != feature:
            continue
        valid, error = validate_feature_name(name)
        if not valid:
            findings.append(
                Finding("invalid-feature", "error", f"{name}: {error}", feature=name)
            )
        valid, error = validate_description(str(spec.get("description") or ""))
        if not valid:
            findings.append(
                Finding("invalid-feature", "error", f"{name}: {error}", feature=name)
            )
    return findings


def check_entries_resolve(
    features: Dict, bases: Set[str], feature: Optional[str] = None
) -> List[Finding]:
    findings = []
    for name, spec in features.items():
        if feature is not None and name != feature:
            continue
        if is_series_feature(spec):
            continue
        for entry in spec.get("files") or []:
            if entry.endswith("/"):
                if not any(base.startswith(entry) for base in bases):
                    findings.append(
                        Finding(
                            "empty-dir",
                            "error",
                            f"{name}: directory entry '{entry}' has no patches under it",
                            feature=name,
                            path=entry,
                        )
                    )
            elif entry not in bases:
                findings.append(
                    Finding(
                        "missing-patch",
                        "error",
                        f"{name}: no patch on disk for entry '{entry}'",
                        feature=name,
                        path=entry,
                    )
                )
    return findings


def check_classification(
    claims: Dict[str, List[str]], feature: Optional[str] = None
) -> List[Finding]:
    """Unclassified patches (error) and multi-claimed patches (warning)."""
    findings = []
    for base, owners in claims.items():
        if not owners:
            if feature is None:
                findings.append(
                    Finding(
                        "unclassified",
                        "error",
                        f"patch not claimed by any feature: {base}",
                        path=base,
                    )
                )
        elif len(owners) > 1 and (feature is None or feature in owners):
            findings.append(
                Finding(
                    "multi-claim",
                    "warning",
                    f"patch claimed by multiple features ({', '.join(owners)}): {base}",
                    path=base,
                )
            )
    return findings


def check_repo(
    features: Dict, patches_dir: Path, feature: Optional[str] = None
) -> List[Finding]:
    """All repo-local checks; raises ValueError for an unknown feature filter."""
    if feature is not None and feature not in features:
        raise ValueError(
            f"unknown feature '{feature}'. Valid: {', '.join(sorted(features))}"
        )
    bases = patch_base_paths(patches_dir)
    claims = compute_claims(features, bases)
    findings = [
        *check_feature_metadata(features, feature),
        *check_entries_resolve(features, bases, feature),
        *check_classification(claims, feature),
    ]
    return sorted(findings, key=lambda f: (f.check, f.feature or "", f.path or ""))


def load_features(root_dir: Path) -> Dict:
    from .features_io import load_features_yaml

    data = load_features_yaml(root_dir / "bos_build" / "features.yaml")
    return data.get("features") or {}


def diagnose_repo(root_dir: Path, feature: Optional[str] = None) -> List[Finding]:
    """Repo-local checks against a browseros package root."""
    return check_repo(load_features(root_dir), root_dir / "chromium_patches", feature)
