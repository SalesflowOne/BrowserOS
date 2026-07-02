#!/usr/bin/env python3
"""Extensions module - regenerate the extension update manifests coherently.

One command owns update-manifest(.alpha).xml + extensions(.alpha).json +
bundled-manifest.xml so the three can never drift (the live alpha manifest
fell behind prod under hand-editing). CRX building is out of scope — the
crx objects must already exist in R2 (HEAD-checked before any write).
"""

from typing import Dict, List

from ..core.context import Context
from ..core.step import Step, ValidationError
from ..lib.r2 import BOTO3_AVAILABLE
from ..lib.utils import log_info
from .feeds.publisher import FeedPublisher
from .feeds.render import (
    extract_manifest_versions,
    render_extensions_json,
    render_update_manifest,
)
from .feeds.spec import (
    EXTENSIONS,
    bundled_manifest_feed,
    extension_by_name,
    extensions_json_feed,
    update_manifest_feed,
)

CHANNELS = ("alpha", "prod")


def parse_set_options(entries: List[str]) -> Dict[str, str]:
    """Parse repeatable --set name=version options into a dict."""
    versions: Dict[str, str] = {}
    for entry in entries:
        name, sep, version = entry.partition("=")
        if not sep or not name or not version:
            raise ValueError(f"--set expects name=version, got '{entry}'")
        versions[name] = version
    return versions


class ExtensionsFeedModule(Step):
    """Regenerate extension manifests + config for one channel"""

    produces = []
    requires = []
    description = "Generate extension update manifests"

    def __init__(
        self,
        channel: str,
        set_versions: Dict[str, str],
        publish: bool = False,
        allow_downgrade: bool = False,
        publisher=None,
    ):
        self.channel = channel
        self.set_versions = set_versions
        self.publish = publish
        self.allow_downgrade = allow_downgrade
        self._publisher = publisher

    def validate(self, ctx: Context) -> None:
        if not BOTO3_AVAILABLE:
            raise ValidationError(
                "boto3 library not installed - run: pip install boto3"
            )

        if not ctx.env.has_r2_config():
            raise ValidationError("R2 configuration not set")

        if self.channel not in CHANNELS:
            raise ValidationError(
                f"channel must be one of {'/'.join(CHANNELS)}, got '{self.channel}'"
            )

        for name, version in self.set_versions.items():
            try:
                extension_by_name(name)
            except ValueError as e:
                raise ValidationError(str(e))
            if not version:
                raise ValidationError(f"--set {name}= is missing a version")

    def execute(self, ctx: Context) -> None:
        publisher = self._publisher or FeedPublisher(env=ctx.env)

        versions = self._resolve_versions(publisher)
        log_info(
            "Extension versions: "
            + ", ".join(f"{n}={v}" for n, v in sorted(versions.items()))
        )

        self._check_crx_objects(publisher, versions)

        update_feed_versions = {
            ext.name: versions[ext.name]
            for ext in EXTENSIONS
            if ext.in_update_feed
        }

        # Manifest first, then the config pointing at it, then the
        # build-time bundled manifest — abort on the first refused write so
        # a guard failure can't leave the trio half-updated.
        outputs = (
            (update_manifest_feed(self.channel),
             render_update_manifest(update_feed_versions)),
            (extensions_json_feed(self.channel),
             render_extensions_json(self.channel)),
            (bundled_manifest_feed(), render_update_manifest(versions)),
        )
        for spec, content in outputs:
            if not publisher.publish(
                spec,
                content,
                publish=self.publish,
                allow_downgrade=self.allow_downgrade,
            ):
                raise RuntimeError(f"Feed refused: {spec.key} — nothing further written")

    def _resolve_versions(self, publisher: FeedPublisher) -> Dict[str, str]:
        """Final name→version map: live bundled < live channel manifest < --set.

        Extensions not being bumped carry over from the live objects so one
        --set can never drop or silently regress the others.
        """
        id_to_name = {ext.extension_id: ext.name for ext in EXTENSIONS}
        versions: Dict[str, str] = {}

        for key in (
            bundled_manifest_feed().key,
            update_manifest_feed(self.channel).key,
        ):
            live = publisher.fetch_live(key)
            if live is None:
                continue
            for ext_id, version in extract_manifest_versions(live).items():
                name = id_to_name.get(ext_id)
                if name:
                    versions[name] = version

        versions.update(self.set_versions)

        missing = [ext.name for ext in EXTENSIONS if ext.name not in versions]
        if missing:
            raise RuntimeError(
                "No live version and no --set for: "
                + ", ".join(sorted(missing))
                + f" (channel {self.channel})"
            )
        return versions

    def _check_crx_objects(
        self, publisher: FeedPublisher, versions: Dict[str, str]
    ) -> None:
        """Every crx referenced by any output must already exist in R2."""
        for name, version in sorted(versions.items()):
            url = extension_by_name(name).crx_url(version)
            status = publisher.http_head(url)
            if status != 200:
                raise RuntimeError(
                    f"crx not found in R2 (HTTP {status}): {url} — upload it "
                    "before regenerating manifests"
                )
