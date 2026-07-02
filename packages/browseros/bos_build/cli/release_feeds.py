#!/usr/bin/env python3
"""Feed-publisher release commands.

Kept in their own module (cli/release.py only calls register()) so the
parallel per-product release-CLI rework doesn't collide with these
additions. Context/execute helpers are intentionally local for the same
reason — importing them from cli/release.py would be a circular import.
"""

import typer

from ..core.context import Context
from ..lib.notify import slack_subscriber
from ..lib.paths import get_package_root
from ..core.runner import StepExecutionError, run as run_steps
from ..lib.utils import log_error
from ..release.appcast import AppcastModule

feeds_app = typer.Typer(
    help="Update-feed inspection",
    pretty_exceptions_enable=False,
    pretty_exceptions_show_locals=False,
)


def _create_context(version: str = "", product: str = "browseros") -> Context:
    root = get_package_root()
    try:
        ctx = Context(
            root_dir=root,
            chromium_src=root,
            architecture="",
            build_type="release",
            product=product,
        )
    except ValueError as e:
        log_error(str(e))
        raise typer.Exit(1)
    ctx.release_version = version
    return ctx


def _execute(ctx: Context, module) -> None:
    try:
        run_steps(ctx, [module], name="release", subscribers=(slack_subscriber,))
    except StepExecutionError as e:
        log_error(str(e))
        raise typer.Exit(1)
    except KeyboardInterrupt:
        raise typer.Exit(130)


def appcast_command(
    version: str = typer.Option(
        ..., "--version", "-v", help="Release version to feed (e.g., 0.47.0.2)"
    ),
    product: str = typer.Option(
        "browseros", "--product", help="Product whose browser feeds to generate"
    ),
    publish: bool = typer.Option(
        False,
        "--publish",
        help="Write to R2 (default is a dry run: full XML + diff vs live)",
    ),
    allow_downgrade: bool = typer.Option(
        False, "--allow-downgrade", help="Override the version-downgrade guard"
    ),
):
    """Generate complete browser appcast feeds from R2 release metadata.

    \b
    Dry run (prints full XML + diff vs live):
      browseros release appcast --version 0.47.0.2

    \b
    Publish (backs up live feeds to feeds-history/ first):
      browseros release appcast --version 0.47.0.2 --publish
    """
    ctx = _create_context(version, product)
    _execute(
        ctx,
        AppcastModule(
            product_id=product, publish=publish, allow_downgrade=allow_downgrade
        ),
    )


def register(app: typer.Typer) -> None:
    """Attach the feed-publisher commands to the release CLI."""
    app.command("appcast")(appcast_command)
