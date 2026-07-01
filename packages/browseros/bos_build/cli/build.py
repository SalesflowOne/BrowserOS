#!/usr/bin/env python3
"""Build CLI - Modular build system for BrowserOS"""

import os
import time
from pathlib import Path
from typing import Optional

import typer

# Import common modules
from ..core.config import load_config, validate_required_envs
from ..core.pipeline import validate_pipeline, show_available_modules
from ..core.resolver import resolve_config, resolve_pipeline
from ..core.notify import (
    notify_pipeline_end,
    notify_pipeline_error,
    set_build_context,
    slack_subscriber,
)
from ..core.runner import StepExecutionError, run as run_pipeline
from ..core.step import (
    all_steps,
    notify_step_names,
    phase_steps,
)
from ..core.utils import (
    log_error,
    log_info,
    log_warning,
    IS_MACOS,
    IS_WINDOWS,
)

# All of these derive from step registration metadata (core/step.py);
# pipeline order within a phase comes from steps/__init__.py import order.
AVAILABLE_MODULES = all_steps()

EXECUTION_ORDER = [
    (phase, phase_steps(phase))
    for phase in ("setup", "prep", "build", "sign", "package", "upload")
]

NOTIFY_MODULES = notify_step_names()


def main(
    config: Optional[Path] = typer.Option(
        None,
        "--config",
        "-c",
        help="Load configuration from YAML file",
        exists=True,
    ),
    modules: Optional[str] = typer.Option(
        None,
        "--modules",
        "-m",
        help="Comma-separated list of modules to run",
    ),
    list_modules: bool = typer.Option(
        False,
        "--list",
        "-l",
        help="List all available modules and exit",
    ),
    # Pipeline phase flags (auto-ordered execution)
    setup: bool = typer.Option(
        False,
        "--setup",
        help="Run setup phase (clean, git_setup, sparkle_setup/winsparkle_setup)",
    ),
    prep: bool = typer.Option(
        False,
        "--prep",
        help="Run prep phase (resources, chromium_replace, string_replaces, patches, configure)",
    ),
    build: bool = typer.Option(
        False,
        "--build",
        help="Run build phase (compile)",
    ),
    sign: bool = typer.Option(
        False,
        "--sign",
        help="Run sign phase (platform-specific: sign_macos/windows/linux)",
    ),
    package: bool = typer.Option(
        False,
        "--package",
        help="Run package phase (platform-specific: package_macos/windows/linux)",
    ),
    upload: bool = typer.Option(
        False,
        "--upload",
        help="Run upload phase (upload artifacts)",
    ),
    # Global options that override config
    arch: Optional[str] = typer.Option(
        None,
        "--arch",
        "-a",
        help="Architecture (arm64, x64, universal)",
    ),
    build_type: Optional[str] = typer.Option(
        None,
        "--build-type",
        "-t",
        help="Build type (debug or release)",
    ),
    chromium_src: Optional[Path] = typer.Option(
        None,
        "--chromium-src",
        "-S",
        help="Path to Chromium source directory",
    ),
):
    """BrowserOS Build System - Modular pipeline executor

    Build BrowserOS using phase flags (auto-ordered), explicit modules, or configs.

    \b
    Phase Flags (Recommended - Auto-Ordered):
      browseros build --setup --build --sign --package
      browseros build --build --sign           # Skip setup
      browseros build --package --sign         # Flags work in any order!

    \b
    Explicit Modules (Power Users):
      browseros build --modules clean,compile,sign_macos

    \b
    Config Files (CI/CD):
      browseros build --config release.yaml --arch arm64

    \b
    List Available:
      browseros build --list                   # Show all modules and phases

    Note: Phase flags always execute in correct order regardless of how you write them.
          --sign and --package auto-select platform (macos/windows/linux)
    """

    # Handle --list flag
    if list_modules:
        show_available_modules(AVAILABLE_MODULES)
        return

    # Check for mutually exclusive options
    has_config = config is not None
    has_modules = modules is not None
    has_flags = any([setup, prep, build, sign, package, upload])

    options_provided = sum([has_config, has_modules, has_flags])

    if options_provided == 0:
        typer.echo(
            "Error: Specify --config, --modules, or phase flags (--setup, --build, etc.)\n"
        )
        typer.echo("Use --help for usage information")
        typer.echo("Use --list to see available modules")
        raise typer.Exit(1)

    if options_provided > 1:
        log_error("Specify only ONE of: --config, --modules, or phase flags")
        log_error("Examples:")
        log_error("  browseros build --setup --build --sign")
        log_error("  browseros build --modules clean,compile")
        log_error("  browseros build --config release.yaml")
        raise typer.Exit(1)

    # CONFIG MODE validation: YAML controls everything, CLI build flags not allowed
    if has_config:
        conflicting_flags = []
        if arch is not None:
            conflicting_flags.append("--arch")
        if build_type is not None:
            conflicting_flags.append("--build-type")

        if conflicting_flags:
            log_error(
                f"CONFIG MODE: Cannot use {', '.join(conflicting_flags)} with --config"
            )
            log_error("When using --config, ALL build parameters come from YAML")
            log_error("Remove the conflicting flags or don't use --config")
            raise typer.Exit(1)

    log_info("🚀 BrowserOS Build System")
    log_info("=" * 70)

    # Load YAML config if provided
    config_data = load_config(config) if config else None

    # Build CLI arguments dictionary for resolver
    root_dir = Path(__file__).parent.parent.parent
    cli_args = {
        "chromium_src": chromium_src,
        "arch": arch,
        "build_type": build_type,
        "modules": modules,
        "setup": setup,
        "prep": prep,
        "build": build,
        "sign": sign,
        "package": package,
        "upload": upload,
    }

    # Resolve build context (CONFIG mode or DIRECT mode).
    # Returns one Context per architecture — single-element for normal
    # builds, multi-element when YAML declares `architecture: [x64, arm64]`.
    try:
        arch_ctxs = resolve_config(cli_args, config_data)
    except ValueError as e:
        log_error(str(e))
        raise typer.Exit(1)

    # Resolve pipeline (CONFIG mode or DIRECT mode)
    try:
        pipeline = resolve_pipeline(
            cli_args,
            config_data,
            execution_order=EXECUTION_ORDER,
        )
    except ValueError as e:
        log_error(str(e))
        raise typer.Exit(1)

    # Show execution plan for flag-based mode
    if has_flags:
        log_info("\n📋 Execution Plan (auto-ordered):")
        log_info("-" * 70)
        phase_names = []
        if setup:
            phase_names.append("setup")
        if prep:
            phase_names.append("prep")
            log_warning("⚠️  --prep does NOT apply series_patches. Run 'browseros build -m series_patches' separately if needed.")
        if build:
            phase_names.append("build")
        if sign:
            phase_names.append(f"sign (→ {', '.join(phase_steps('sign'))})")
        if package:
            phase_names.append(f"package (→ {', '.join(phase_steps('package'))})")
        if upload:
            phase_names.append("upload")

        for phase_name in phase_names:
            log_info(f"  ✓ {phase_name}")

        log_info(f"\n  Pipeline: {' → '.join(pipeline)}")
        log_info("-" * 70)

    # Validate required environment variables (YAML-specific)
    if config_data:
        required_envs = config_data.get("required_envs", [])
        if required_envs:
            validate_required_envs(required_envs)

    # Validate pipeline modules exist
    validate_pipeline(pipeline, AVAILABLE_MODULES)

    # Set Windows-specific environment
    if IS_WINDOWS():
        os.environ["DEPOT_TOOLS_WIN_TOOLCHAIN"] = "0"
        log_info("Set DEPOT_TOOLS_WIN_TOOLCHAIN=0 for Windows build")

    # Print build summary using the first context — versions and paths
    # are identical across per-arch contexts. Architecture is logged again
    # inside the loop below for multi-arch runs.
    summary_ctx = arch_ctxs[0]
    log_info(f"📍 Root: {root_dir}")
    log_info(f"📍 Chromium: {summary_ctx.chromium_src}")
    if len(arch_ctxs) > 1:
        log_info(
            f"📍 Architectures: {[c.architecture for c in arch_ctxs]} (multi-arch loop)"
        )
    else:
        log_info(f"📍 Architecture: {summary_ctx.architecture}")
    log_info(f"📍 Build type: {summary_ctx.build_type}")
    log_info(f"📍 Semantic version: {summary_ctx.semantic_version}")
    log_info(f"📍 Chromium version: {summary_ctx.chromium_version}")
    log_info(f"📍 Build offset: {summary_ctx.browseros_build_offset}")
    log_info(f"📍 Pipeline: {' → '.join(pipeline)}")
    log_info("=" * 70)

    os_name = "macOS" if IS_MACOS() else "Windows" if IS_WINDOWS() else "Linux"

    # Execute the pipeline once per architecture. Steps see a normal
    # single-arch ctx; only this loop knows about multi-arch. For
    # multi-arch invocations one extra whole-run terminal notification
    # fires in the finally, so an interrupted second arch still reports.
    multi_arch = len(arch_ctxs) > 1
    overall_status = "failed"
    overall_error: Optional[str] = None
    overall_start = time.time()
    try:
        for i, arch_ctx in enumerate(arch_ctxs, start=1):
            if multi_arch:
                log_info("\n" + "#" * 70)
                log_info(
                    f"# Architecture {i}/{len(arch_ctxs)}: {arch_ctx.architecture}"
                )
                log_info(f"# Output: {arch_ctx.out_dir}")
                log_info("#" * 70)

            set_build_context(os_name, arch_ctx.architecture)
            run_name = f"build[{arch_ctx.architecture}]" if multi_arch else "build"
            try:
                run_pipeline(
                    arch_ctx,
                    pipeline,
                    name=run_name,
                    subscribers=(slack_subscriber,),
                    available=AVAILABLE_MODULES,
                )
            except StepExecutionError as e:
                overall_error = str(e)
                raise typer.Exit(1)
            except KeyboardInterrupt:
                overall_status = "interrupted"
                overall_error = "Interrupted by user"
                raise typer.Exit(130)
        overall_status = "success"
    finally:
        if multi_arch:
            duration = time.time() - overall_start
            if overall_status == "success":
                notify_pipeline_end("build (all architectures)", duration)
            else:
                notify_pipeline_error(
                    "build (all architectures)", overall_error or overall_status
                )
