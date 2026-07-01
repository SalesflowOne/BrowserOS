#!/usr/bin/env python3
"""Build CLI - Modular build system for BrowserOS"""

import os
import time
from dataclasses import replace
from pathlib import Path
from typing import List, Optional, Tuple

import typer

from ..core.context import Context
from ..core.paths import get_package_root
from ..core.pipeline import validate_pipeline, show_available_modules
from ..core.planner import Switches, load_profile, plan, preflight
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



def main(
    preset: Optional[str] = typer.Option(
        None,
        "--preset",
        help="Pipeline preset: release or debug (planner composes the steps)",
    ),
    profile: Optional[Path] = typer.Option(
        None,
        "--profile",
        help="Profile file of saved switches (bos_build/profiles/*.yaml or a path)",
    ),
    product: Optional[str] = typer.Option(
        None,
        "--product",
        "-p",
        help="Product to build (browseros, browserclaw)",
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
    package: bool = typer.Option(
        False,
        "--package",
        help="Run package phase (platform-specific: package_macos/windows/linux)",
    ),
    # Tri-state toggles: phase flag when used alone (--sign / --upload);
    # switch override in preset/profile mode (--no-sign / --no-upload).
    sign: Optional[bool] = typer.Option(
        None,
        "--sign/--no-sign",
        help="Phase mode: run sign phase. Preset mode: toggle signing",
    ),
    upload: Optional[bool] = typer.Option(
        None,
        "--upload/--no-upload",
        help="Phase mode: run upload phase. Preset mode: toggle upload",
    ),
    clean: Optional[bool] = typer.Option(
        None,
        "--clean/--no-clean",
        help="Preset mode: toggle the clean step",
    ),
    provision: Optional[str] = typer.Option(
        None,
        "--provision",
        help="Preset mode: chromium provisioning (none, full, shallow)",
    ),
    download: Optional[bool] = typer.Option(
        None,
        "--download/--no-download",
        help="Preset mode: toggle downloading server resources from R2",
    ),
    # Global options
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
        help="Build type for --modules/phase mode (debug or release)",
    ),
    chromium_src: Optional[Path] = typer.Option(
        None,
        "--chromium-src",
        "-S",
        help="Path to Chromium source directory",
    ),
):
    """BrowserOS Build System - Modular pipeline executor

    Build BrowserOS with a preset (planner-composed), phase flags, or
    explicit modules.

    \b
    Presets (Recommended - one pipeline definition, switches select):
      browseros build --preset release --product browseros --arch arm64
      browseros build --preset release --product browserclaw --no-upload
      browseros build --profile nightly-ci --arch x64
      browseros build --preset debug

    \b
    Phase Flags (Auto-Ordered):
      browseros build --setup --build --sign --package
      browseros build --build --sign           # Skip setup

    \b
    Explicit Modules (Power Users):
      browseros build --modules clean,compile,sign_macos

    \b
    List Available:
      browseros build --list                   # Show all modules and phases
    """

    if list_modules:
        show_available_modules(AVAILABLE_MODULES)
        return

    has_preset = preset is not None or profile is not None
    has_modules = modules is not None
    # --sign/--upload given affirmatively without a preset are phase flags
    phase_sign = sign is True and not has_preset
    phase_upload = upload is True and not has_preset
    has_flags = any([setup, prep, build, package, phase_sign, phase_upload])

    options_provided = sum([has_preset, has_modules, has_flags])

    if options_provided == 0:
        typer.echo(
            "Error: Specify --preset/--profile, --modules, or phase flags (--setup, --build, etc.)\n"
        )
        typer.echo("Use --help for usage information")
        typer.echo("Use --list to see available modules")
        raise typer.Exit(1)

    if options_provided > 1:
        log_error("Specify only ONE of: --preset/--profile, --modules, or phase flags")
        log_error("Examples:")
        log_error("  browseros build --preset release --product browserclaw")
        log_error("  browseros build --setup --build --sign")
        log_error("  browseros build --modules clean,compile")
        raise typer.Exit(1)

    log_info("🚀 BrowserOS Build System")
    log_info("=" * 70)

    root_dir = get_package_root()

    if has_preset:
        if build_type is not None:
            log_error("--build-type is owned by the preset (release/debug); drop it")
            raise typer.Exit(1)
        runs = _resolve_preset_runs(
            preset=preset,
            profile=profile,
            product=product,
            arch=arch,
            clean=clean,
            provision=provision,
            download=download,
            sign=sign,
            upload=upload,
            chromium_src=chromium_src,
        )
    else:
        cli_args = {
            "chromium_src": chromium_src,
            "arch": arch,
            "build_type": build_type,
            "product": product,
            "modules": modules,
            "setup": setup,
            "prep": prep,
            "build": build,
            "sign": phase_sign,
            "package": package,
            "upload": phase_upload,
        }
        try:
            arch_ctxs = resolve_config(cli_args)
            pipeline = resolve_pipeline(cli_args, execution_order=EXECUTION_ORDER)
        except ValueError as e:
            log_error(str(e))
            raise typer.Exit(1)
        runs = [(ctx, pipeline) for ctx in arch_ctxs]

    if has_flags:
        log_info("\n📋 Execution Plan (auto-ordered):")
        log_info("-" * 70)
        if prep:
            log_warning(
                "⚠️  --prep does NOT apply series_patches. Run 'browseros build -m series_patches' separately if needed."
            )
        log_info(f"  Pipeline: {' → '.join(runs[0][1])}")
        log_info("-" * 70)

    for _, run_steps in runs:
        validate_pipeline(run_steps, AVAILABLE_MODULES)

    # Whole-pipeline static preflight (env from step metadata, platform,
    # per-step static checks) for EVERY arch before any run starts — a
    # misconfigured second arch must not surface after hours of arch one.
    try:
        for run_ctx, run_steps in runs:
            preflight(run_steps, ctx=run_ctx)
    except ValueError as e:
        log_error(str(e))
        raise typer.Exit(1)

    if IS_WINDOWS():
        os.environ["DEPOT_TOOLS_WIN_TOOLCHAIN"] = "0"
        log_info("Set DEPOT_TOOLS_WIN_TOOLCHAIN=0 for Windows build")

    # Print build summary using the first context — versions and paths
    # are identical across per-arch contexts.
    summary_ctx = runs[0][0]
    log_info(f"📍 Root: {root_dir}")
    log_info(f"📍 Chromium: {summary_ctx.chromium_src}")
    if len(runs) > 1:
        log_info(
            f"📍 Architectures: {[c.architecture for c, _ in runs]} (multi-arch loop)"
        )
    else:
        log_info(f"📍 Architecture: {summary_ctx.architecture}")
    log_info(f"📍 Product: {summary_ctx.product.id}")
    log_info(f"📍 Build type: {summary_ctx.build_type}")
    log_info(f"📍 Semantic version: {summary_ctx.semantic_version}")
    log_info(f"📍 Chromium version: {summary_ctx.chromium_version}")
    log_info(f"📍 Build offset: {summary_ctx.browseros_build_offset}")
    log_info(f"📍 Pipeline: {' → '.join(runs[0][1])}")
    log_info("=" * 70)

    os_name = "macOS" if IS_MACOS() else "Windows" if IS_WINDOWS() else "Linux"

    # Execute once per architecture. Steps see a normal single-arch ctx;
    # only this loop knows about multi-arch. For multi-arch invocations
    # one extra whole-run terminal notification fires in the finally, so
    # an interrupted second arch still reports.
    multi_arch = len(runs) > 1
    overall_status = "failed"
    overall_error: Optional[str] = None
    overall_start = time.time()
    try:
        for i, (arch_ctx, run_steps) in enumerate(runs, start=1):
            if multi_arch:
                log_info("\n" + "#" * 70)
                log_info(f"# Architecture {i}/{len(runs)}: {arch_ctx.architecture}")
                log_info(f"# Output: {arch_ctx.out_dir}")
                log_info("#" * 70)

            set_build_context(os_name, arch_ctx.architecture)
            run_name = f"build[{arch_ctx.architecture}]" if multi_arch else "build"
            try:
                run_pipeline(
                    arch_ctx,
                    run_steps,
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


def _resolve_preset_runs(
    *,
    preset: Optional[str],
    profile: Optional[Path],
    product: Optional[str],
    arch: Optional[str],
    clean: Optional[bool],
    provision: Optional[str],
    download: Optional[bool],
    sign: Optional[bool],
    upload: Optional[bool],
    chromium_src: Optional[Path],
) -> List[Tuple[Context, List[str]]]:
    """Resolve preset/profile + CLI overrides into per-arch (ctx, steps) runs.

    Precedence: CLI > profile > preset defaults.
    """
    try:
        switches = load_profile(_resolve_profile_path(profile)) if profile else Switches()
        overrides = {}
        if preset is not None:
            overrides["preset"] = preset
        if product is not None:
            overrides["product"] = product
        if arch is not None:
            overrides["architectures"] = (arch,)
        if clean is not None:
            overrides["clean"] = clean
        if provision is not None:
            overrides["provision"] = provision
        if download is not None:
            overrides["download"] = download
        if sign is not None:
            overrides["sign"] = sign
        if upload is not None:
            overrides["upload"] = upload
        switches = replace(switches, **overrides).resolved()

        # Shallow provisioning creates the checkout itself, so the src
        # dir may not exist yet on a fresh runner.
        src = _resolve_chromium_src(
            chromium_src, allow_missing=switches.provision == "shallow"
        )

        log_info(f"✓ PRESET MODE: preset={switches.preset} product={switches.product}")
        log_info(
            f"✓ PRESET MODE: clean={switches.clean} provision={switches.provision} "
            f"download={switches.download} sign={switches.sign} upload={switches.upload}"
        )

        runs: List[Tuple[Context, List[str]]] = []
        for run_arch in switches.architectures:
            ctx = Context(
                chromium_src=src,
                architecture=run_arch,
                build_type=switches.build_type,
                product=switches.product,
            )
            runs.append((ctx, plan(switches, run_arch)))
        return runs
    except ValueError as e:
        log_error(str(e))
        raise typer.Exit(1)


def _resolve_profile_path(profile: Path) -> Path:
    """Accept a bare profile name (nightly-ci) or a path to a yaml file."""
    if profile.exists():
        return profile
    candidate = get_package_root() / "bos_build" / "profiles" / f"{profile.name}.yaml"
    if candidate.exists():
        return candidate
    raise ValueError(
        f"Profile not found: {profile} (also tried {candidate})"
    )


def _resolve_chromium_src(
    chromium_src: Optional[Path], allow_missing: bool = False
) -> Path:
    """chromium_src: CLI > CHROMIUM_SRC env > error (same as direct mode)."""
    from ..core.env import EnvConfig

    src = chromium_src or EnvConfig().chromium_src
    if not src:
        raise ValueError(
            "chromium_src required!\n"
            "Provide via one of:\n"
            "  --chromium-src PATH\n"
            "  CHROMIUM_SRC environment variable"
        )
    src = Path(src)
    if not src.exists() and not allow_missing:
        raise ValueError(f"chromium_src does not exist: {src}")
    return src
