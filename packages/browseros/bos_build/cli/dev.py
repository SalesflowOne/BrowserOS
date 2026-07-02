#!/usr/bin/env python3
"""
Dev CLI - Chromium patch extraction

Extracts commits or files from a Chromium checkout into chromium_patches/.
Interactive patch application, sync, and conflict handling live in the Go
tool (tools/patch, `bpatch`) — this CLI deliberately keeps only extract.
"""

from pathlib import Path
from typing import Optional

import typer
from typer import Typer, Option, Argument

from ..core.context import Context
from ..lib.utils import log_info, log_error, log_success, log_warning


def create_build_context(chromium_src: Optional[Path] = None) -> Optional[Context]:
    """Create Context for dev CLI operations"""
    try:
        if not chromium_src:
            log_error("Chromium source directory not specified")
            log_info(
                "Use --chromium-src option to specify the Chromium source directory"
            )
            return None

        if not chromium_src.exists():
            log_error(f"Chromium source directory does not exist: {chromium_src}")
            return None

        return Context(
            chromium_src=chromium_src,
            architecture="",  # Not needed for patch operations
            build_type="debug",  # Not needed for patch operations
        )
    except Exception as e:
        log_error(f"Failed to create build context: {e}")
        return None


app = Typer(
    name="dev",
    help="BrowserOS dev CLI",
    no_args_is_help=True,
    pretty_exceptions_enable=False,
    pretty_exceptions_show_locals=False,
)


class State:
    def __init__(self):
        self.chromium_src: Optional[Path] = None
        self.verbose: bool = False
        self.quiet: bool = False


state = State()


@app.callback()
def main(
    chromium_src: Optional[Path] = Option(
        None,
        "--chromium-src",
        "-S",
        help="Path to Chromium source directory",
        exists=True,
    ),
    verbose: bool = Option(False, "--verbose", "-v", help="Enable verbose output"),
    quiet: bool = Option(False, "--quiet", "-q", help="Suppress non-essential output"),
):
    """
    Dev CLI - Chromium patch extraction

    Extract patches from commits:
      browseros dev extract commit HEAD
      browseros dev extract range HEAD~5 HEAD
      browseros dev extract patch chrome/common/foo.h

    Applying and syncing patches is handled by the Go tool: bpatch
    (packages/browseros/tools/patch).
    """
    state.chromium_src = chromium_src
    state.verbose = verbose
    state.quiet = quiet


extract_app = Typer(
    help="Extract patches from commits",
    no_args_is_help=True,
    pretty_exceptions_enable=False,
    pretty_exceptions_show_locals=False,
)

app.add_typer(extract_app, name="extract")


@extract_app.command(name="commit")
def extract_commit(
    commit: str = Argument(..., help="Git commit reference (e.g., HEAD)"),
    output: Optional[Path] = Option(None, "--output", "-o", help="Output directory"),
    interactive: bool = Option(
        True, "--interactive/--no-interactive", "-i/-n", help="Interactive mode"
    ),
    force: bool = Option(False, "--force", "-f", help="Overwrite existing patches"),
    include_binary: bool = Option(
        False, "--include-binary", help="Include binary files"
    ),
    base: Optional[str] = Option(
        None,
        "--base",
        help="Base commit to diff from for BASE_COMMIT-relative extraction (defaults to BASE_COMMIT)",
    ),
    feature: bool = Option(
        False, "--feature", help="Add extracted files to a feature in features.yaml"
    ),
):
    """Extract patches from a single commit"""
    ctx = create_build_context(state.chromium_src)
    if not ctx:
        raise typer.Exit(1)

    from ..patchkit.extract import ExtractCommitModule

    module = ExtractCommitModule()
    try:
        module.validate(ctx)
        module.execute(
            ctx,
            commit=commit,
            output=output,
            interactive=interactive,
            verbose=state.verbose,
            force=force,
            include_binary=include_binary,
            base=base,
            feature=feature,
        )
    except Exception as e:
        log_error(f"Failed to extract commit: {e}")
        raise typer.Exit(1)


@extract_app.command(name="patch")
def extract_patch_cmd(
    chromium_path: str = Argument(
        ..., help="Chromium file path (e.g., chrome/common/foo.h)"
    ),
    base: Optional[str] = Option(
        None,
        "--base",
        "-b",
        help="Base commit to diff against (defaults to BASE_COMMIT)",
    ),
    force: bool = Option(
        False, "--force", "-f", help="Overwrite existing patch without prompting"
    ),
    feature: bool = Option(
        False, "--feature", help="Add extracted file to a feature in features.yaml"
    ),
):
    """Extract patch for a specific file"""
    ctx = create_build_context(state.chromium_src)
    if not ctx:
        raise typer.Exit(1)

    from ..patchkit.extract import extract_single_file_patch

    success, error = extract_single_file_patch(ctx, chromium_path, base, force)
    if not success:
        log_error(error or "Unknown error")
        raise typer.Exit(1)
    log_success(f"Successfully extracted patch for: {chromium_path}")

    if feature:
        from ..patchkit.extract.common import resolve_base_commit
        from ..patchkit.extract.utils import GitError
        from ..patchkit.features_io import (
            add_files_to_feature,
            prompt_feature_selection,
        )

        try:
            resolved_base = resolve_base_commit(ctx, base)
        except GitError as e:
            log_error(str(e))
            raise typer.Exit(1)

        result = prompt_feature_selection(ctx, resolved_base[:12], None)
        if result is None:
            log_warning("Skipped adding file to feature")
        else:
            feature_name, description = result
            add_files_to_feature(ctx, feature_name, description, [chromium_path])


@extract_app.command(name="range")
def extract_range(
    start: str = Argument(..., help="Start commit (exclusive)"),
    end: str = Argument(..., help="End commit (inclusive)"),
    output: Optional[Path] = Option(None, "--output", "-o", help="Output directory"),
    interactive: bool = Option(
        True, "--interactive/--no-interactive", "-i/-n", help="Interactive mode"
    ),
    force: bool = Option(False, "--force", "-f", help="Overwrite existing patches"),
    include_binary: bool = Option(
        False, "--include-binary", help="Include binary files"
    ),
    squash: bool = Option(
        False, "--squash", help="Squash all commits into single patches"
    ),
    base: Optional[str] = Option(
        None,
        "--base",
        help="Base commit to diff from (defaults to BASE_COMMIT)",
    ),
    feature: bool = Option(
        False, "--feature", help="Add extracted files to a feature in features.yaml"
    ),
):
    """Extract patches from a range of commits"""
    ctx = create_build_context(state.chromium_src)
    if not ctx:
        raise typer.Exit(1)

    from ..patchkit.extract import ExtractRangeModule

    module = ExtractRangeModule()
    try:
        module.validate(ctx)
        module.execute(
            ctx,
            start=start,
            end=end,
            output=output,
            interactive=interactive,
            verbose=state.verbose,
            force=force,
            include_binary=include_binary,
            squash=squash,
            base=base,
            feature=feature,
        )
    except Exception as e:
        log_error(f"Failed to extract range: {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
