from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

from .env import load_dotenv
from .harness import RunOptions, run_eval
from .providers import ProviderClient

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TASKS = PROJECT_ROOT / "examples" / "tasks.jsonl"
DEFAULT_MODELS = PROJECT_ROOT / "examples" / "models.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Quick VLM click-point eval harness")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="run a click-point evaluation")
    run_parser.add_argument(
        "--tasks",
        type=Path,
        default=DEFAULT_TASKS,
        help=f"JSONL task manifest (default: {DEFAULT_TASKS})",
    )
    run_parser.add_argument(
        "--models",
        type=Path,
        default=DEFAULT_MODELS,
        help=f"model config JSON (default: {DEFAULT_MODELS})",
    )
    run_parser.add_argument(
        "--out",
        type=Path,
        help="output run directory (default: runs/<timestamp>)",
    )
    run_parser.add_argument("--no-annotate", action="store_true", help="skip annotated PNGs")
    run_parser.add_argument("--fail-fast", action="store_true", help="stop on first GT error")
    run_parser.add_argument("--no-progress", action="store_true", help="hide progress/log output")
    run_parser.add_argument("--limit", type=int, help="only run the first N tasks")
    run_parser.add_argument(
        "--timeout",
        type=int,
        default=60 * 4,
        help="API timeout seconds; also used as local HF generation max_time",
    )

    args = parser.parse_args(argv)
    if args.command == "run":
        load_dotenv(PROJECT_ROOT / ".env")
        load_dotenv(Path.cwd() / ".env")
        out_dir = args.out or _default_out_dir()
        client = ProviderClient(
            timeout_seconds=args.timeout,
            log_callback=None if args.no_progress else _stderr_log,
        )
        summary = run_eval(
            RunOptions(
                tasks_path=args.tasks,
                models_path=args.models,
                out_dir=out_dir,
                annotate=not args.no_annotate,
                fail_fast=args.fail_fast,
                limit=args.limit,
                progress=not args.no_progress,
            ),
            client.predict_point,
        )
        print(f"Wrote run to {out_dir}")
        result_rows = summary.get("result_rows", [])
        if isinstance(result_rows, list):
            print(_format_result_table(result_rows))
        return 0

    parser.error(f"unknown command: {args.command}")
    return 2


def _default_out_dir() -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return PROJECT_ROOT / "runs" / timestamp


def _stderr_log(message: str) -> None:
    print(message, file=sys.stderr)


def _format_result_table(rows: list[dict[str, object]]) -> str:
    headers = ["Model", "Status", "L2", "Duration", "Reason"]
    table_rows = [
        [
            str(row.get("model", "")),
            str(row.get("status", "")),
            _format_l2(row.get("l2")),
            _format_duration(row.get("duration_seconds")),
            str(row.get("reason") or ""),
        ]
        for row in rows
    ]
    widths = [
        max([len(headers[index]), *(len(row[index]) for row in table_rows)])
        for index in range(len(headers))
    ]
    lines = ["Results"]
    lines.append(_format_table_line(headers, widths))
    lines.append(_format_table_line(["-" * width for width in widths], widths))
    lines.extend(_format_table_line(row, widths) for row in table_rows)
    return "\n".join(lines)


def _format_table_line(cells: list[str], widths: list[int]) -> str:
    return "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(cells))


def _format_l2(value: object) -> str:
    return "n/a" if value is None else f"{float(value):.2f}px"


def _format_duration(value: object) -> str:
    return "n/a" if value is None else f"{float(value):.2f}s"
