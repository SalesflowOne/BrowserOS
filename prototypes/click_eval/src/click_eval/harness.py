from __future__ import annotations

import csv
import concurrent.futures
import json
import math
import statistics
import sys
import time
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from tqdm import tqdm

from .contracts import ClickTask, ModelReply, ModelSkipped, ModelSpec, Point
from .io import load_model_config, load_tasks, write_jsonl
from .parsing import parse_point_response, parse_point_value
from .scoring import SCORE_FIELDNAMES, score_point, summarize_scores
from .viz import annotate_image

PredictPoint = Callable[[ModelSpec, Path, str, str], ModelReply]
OPENROUTER_CANDIDATE_CONCURRENCY = 4


@dataclass(frozen=True)
class RunOptions:
    tasks_path: Path
    models_path: Path
    out_dir: Path
    annotate: bool = True
    fail_fast: bool = False
    limit: int | None = None
    model_limit: int | None = None
    progress: bool = True


@dataclass
class TaskRunState:
    task: ClickTask
    gt_point: Point | None
    judge_annotations: list[dict[str, object]]
    annotations: list[dict[str, object]]


def run_eval(options: RunOptions, predict_point: PredictPoint) -> dict[str, object]:
    judges, candidates, config = load_model_config(options.models_path)
    tasks = load_tasks(options.tasks_path)
    if options.limit is not None:
        tasks = tasks[: options.limit]
    if options.model_limit is not None:
        if options.model_limit < 1:
            raise ValueError("model_limit must be at least 1")
        candidates = candidates[: options.model_limit]

    options.out_dir.mkdir(parents=True, exist_ok=True)
    _log(
        options,
        f"Loaded {len(tasks)} task(s), {len(candidates)} candidate model(s). "
        f"Output: {options.out_dir}",
    )
    resolved_rows: list[dict[str, object]] = []
    prediction_rows: list[dict[str, object]] = []
    score_rows: list[dict[str, object]] = []
    task_states: list[TaskRunState] = []

    task_iter = _progress(options, tasks, desc="GT", unit="task")
    for task in task_iter:
        if task.gt_point is not None and judges:
            _log(options, _judge_overlay_log_message(task.task_id, judges))
        elif task.gt_point is not None:
            _log(options, f"[{task.task_id}] Using provided GT")
        elif judges:
            _log(options, _judge_overlay_without_gt_log_message(task.task_id, judges))
        else:
            _log(options, f"[{task.task_id}] No GT; scoring will be n/a")
        try:
            gt_point, resolved = _resolve_ground_truth(task, judges, predict_point)
        except Exception as exc:
            _log(options, f"[{task.task_id}] GT failed: {exc}")
            if options.fail_fast:
                raise
            resolved = dict(task.raw)
            resolved["ground_truth_error"] = str(exc)
            resolved_rows.append(resolved)
            continue

        if gt_point is None:
            _log(options, f"[{task.task_id}] GT: n/a")
        else:
            _log(options, f"[{task.task_id}] GT: ({gt_point.x:.1f}, {gt_point.y:.1f})")
        _log_judge_statuses(options, task.task_id, resolved)
        resolved_rows.append(resolved)
        judge_annotations = _judge_annotations(resolved, gt_point)
        task_states.append(
            TaskRunState(
                task=task,
                gt_point=gt_point,
                judge_annotations=judge_annotations,
                annotations=[],
            )
        )

    for model, state, prediction in _predict_candidates_for_tasks(
        options, task_states, candidates, predict_point
    ):
        prediction_rows.append(prediction)
        parsed_point = prediction.get("_point")
        point = parsed_point if isinstance(parsed_point, Point) else None
        score = score_point(
            state.task.task_id,
            model.name,
            state.gt_point,
            point,
            error=str(prediction.get("error") or ""),
        )
        score["duration_seconds"] = prediction.get("duration_seconds", "")
        score["skipped"] = bool(prediction.get("skipped"))
        score_rows.append(score)
        if point is not None:
            state.annotations.append(
                {
                    "model": model.name,
                    "point": point,
                    "l2": score["l2"] if score["l2"] != "" else None,
                }
            )

    for state in task_states:
        if options.annotate:
            annotate_image(
                state.task.image_path,
                options.out_dir / "annotated" / f"{state.task.task_id}.png",
                state.gt_point,
                state.annotations,
                judge_points=state.judge_annotations,
            )

    for row in prediction_rows:
        row.pop("_point", None)

    summary = {
        "tasks": len(tasks),
        "models": [model.name for model in candidates],
        "judge_models": [judge.model_id for judge in judges],
        "config": {
            key: value
            for key, value in config.items()
            if key not in {"candidate_models", "judge_model", "judge_models"}
        },
        "summary": summarize_scores(score_rows),
        "result_rows": _build_result_rows(score_rows),
    }

    write_jsonl(options.out_dir / "resolved_tasks.jsonl", resolved_rows)
    write_jsonl(options.out_dir / "predictions.jsonl", prediction_rows)
    _write_scores_csv(options.out_dir / "scores.csv", score_rows)
    (options.out_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    _log(options, f"Wrote results to {options.out_dir}")
    return summary


def _predict_candidates_for_tasks(
    options: RunOptions,
    task_states: list[TaskRunState],
    candidates: list[ModelSpec],
    predict_point: PredictPoint,
) -> list[tuple[ModelSpec, TaskRunState, dict[str, object]]]:
    predictions: list[tuple[ModelSpec, TaskRunState, dict[str, object]]] = []
    progress_bar = _candidate_progress(
        options, len(task_states) * len(candidates), "Candidates"
    )
    try:
        for model in candidates:
            with _model_run_context(predict_point, model):
                if model.provider.lower() == "openrouter":
                    for state, prediction in _predict_openrouter_model_for_tasks(
                        options, model, task_states, predict_point
                    ):
                        predictions.append((model, state, prediction))
                        _log_prediction_status(
                            options, state.task.task_id, model, prediction
                        )
                        _update_progress(progress_bar)
                    continue

                for state in task_states:
                    _log_running(options, state.task.task_id, model)
                    prediction = _predict_candidate(
                        state.task, model, predict_point
                    )
                    predictions.append((model, state, prediction))
                    _log_prediction_status(
                        options, state.task.task_id, model, prediction
                    )
                    _update_progress(progress_bar)
    finally:
        if progress_bar is not None:
            progress_bar.close()

    return predictions


def _predict_openrouter_model_for_tasks(
    options: RunOptions,
    model: ModelSpec,
    task_states: list[TaskRunState],
    predict_point: PredictPoint,
) -> list[tuple[TaskRunState, dict[str, object]]]:
    if not task_states:
        return []

    for state in task_states:
        _log_running(options, state.task.task_id, model)

    max_workers = min(OPENROUTER_CANDIDATE_CONCURRENCY, len(task_states))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(_predict_candidate, state.task, model, predict_point)
            for state in task_states
        ]
        return [
            (state, future.result())
            for state, future in zip(task_states, futures, strict=True)
        ]


def _model_run_context(predict_point: PredictPoint, model: ModelSpec):
    owner = getattr(predict_point, "__self__", None)
    context_factory = getattr(owner, "model_run_context", None)
    if context_factory is None:
        return nullcontext()
    return context_factory(model)


def _resolve_ground_truth(
    task, judges: list[ModelSpec], predict_point: PredictPoint
) -> tuple[Point | None, dict[str, object]]:
    resolved = dict(task.raw)
    if task.gt_point is not None:
        resolved["gt_point"] = task.gt_point.as_list()
        if judges:
            judge_rows, successful = _resolve_judges(task, judges, predict_point)
            resolved["gt_judges"] = judge_rows
            resolved["gt_models"] = [
                judge.model_id for judge, _point, _reason, _raw in successful
            ]
            resolved["gt_model"] = "provided"
            resolved["gt_reason"] = "provided gt_point; judges recorded for overlay"
        return task.gt_point, resolved

    resolved["gt_point"] = None
    resolved["gt_model"] = None
    resolved["gt_reason"] = "missing gt_point; candidates are unscored"
    if judges:
        judge_rows, successful = _resolve_judges(task, judges, predict_point)
        resolved["gt_judges"] = judge_rows
        resolved["gt_models"] = [
            judge.model_id for judge, _point, _reason, _raw in successful
        ]
        resolved["gt_reason"] = (
            "missing gt_point; judges recorded for overlay only"
        )
    return None, resolved


def _resolve_judges(
    task,
    judges: list[ModelSpec],
    predict_point: PredictPoint,
) -> tuple[list[dict[str, object]], list[tuple[ModelSpec, Point, str | None, str]]]:
    successful: list[tuple[ModelSpec, Point, str | None, str]] = []
    judge_results = _predict_judges_for_task(task, judges, predict_point)
    judge_rows = [row for row, _point, _reason, _raw_text in judge_results]
    for judge, (_row, point, reason, raw_text) in zip(
        judges, judge_results, strict=True
    ):
        if point is not None:
            successful.append((judge, point, reason, raw_text))
    return judge_rows, successful


def _predict_judge(
    task,
    judge: ModelSpec,
    predict_point: PredictPoint,
) -> tuple[dict[str, object], Point | None, str | None, str]:
    row: dict[str, object] = {
        "name": judge.name,
        "provider": judge.provider,
        "model_id": judge.model_id,
        "point": None,
        "reason": None,
        "raw_text": None,
        "error": None,
        "skipped": False,
        "duration_seconds": None,
    }
    started = time.perf_counter()
    try:
        reply = predict_point(judge, task.image_path, task.instruction, "ground_truth")
    except ModelSkipped as exc:
        row["duration_seconds"] = time.perf_counter() - started
        row["skipped"] = True
        row["error"] = str(exc)
        return row, None, None, ""
    except Exception as exc:
        row["duration_seconds"] = time.perf_counter() - started
        row["error"] = str(exc)
        return row, None, None, ""

    row["duration_seconds"] = time.perf_counter() - started
    parsed = parse_point_response(reply.text)
    row["raw_text"] = reply.text
    row["reason"] = parsed.reason
    if parsed.point is None:
        row["error"] = parsed.error
        return row, None, parsed.reason, reply.text

    row["point"] = parsed.point.as_list()
    return row, parsed.point, parsed.reason, reply.text


def _judge_overlay_log_message(task_id: str, judges: list[ModelSpec]) -> str:
    names = ", ".join(judge.name for judge in judges)
    return (
        f"[{task_id}] Using provided GT and resolving "
        f"{len(judges)} judge overlay(s): {names}"
    )


def _judge_overlay_without_gt_log_message(task_id: str, judges: list[ModelSpec]) -> str:
    names = ", ".join(judge.name for judge in judges)
    return (
        f"[{task_id}] No GT; resolving {len(judges)} judge overlay(s) "
        f"without scoring fallback: {names}"
    )


def _judge_annotations(
    resolved: dict[str, object], gt_point: Point | None
) -> list[dict[str, object]]:
    rows = resolved.get("gt_judges")
    if not isinstance(rows, list):
        return []

    annotations: list[dict[str, object]] = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        point = parse_point_value(row.get("point"))
        annotations.append(
            {
                "label": f"GT{index}",
                "model": str(
                    row.get("name") or row.get("model_id") or f"judge-{index}"
                ),
                "point": point,
                "l2": (
                    math.hypot(point.x - gt_point.x, point.y - gt_point.y)
                    if point is not None and gt_point is not None
                    else None
                ),
                "error": row.get("error"),
                "skipped": row.get("skipped"),
            }
        )
    return annotations


def _log_judge_statuses(
    options: RunOptions, task_id: str, resolved: dict[str, object]
) -> None:
    rows = resolved.get("gt_judges")
    if not isinstance(rows, list):
        return

    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or row.get("model_id") or f"judge-{index}")
        duration = row.get("duration_seconds")
        duration_text = (
            f" in {float(duration):.2f}s"
            if isinstance(duration, int | float)
            else ""
        )
        error = row.get("error")
        if row.get("skipped"):
            _log(options, f"[{task_id}] GT{index} {name} skipped{duration_text}: {error}")
            continue
        if error:
            _log(options, f"[{task_id}] GT{index} {name} failed{duration_text}: {error}")
            continue
        point = parse_point_value(row.get("point"))
        if point is None:
            _log(options, f"[{task_id}] GT{index} {name} finished{duration_text}: no point")
            continue
        _log(
            options,
            f"[{task_id}] GT{index} {name} finished{duration_text}: "
            f"({point.x:.1f}, {point.y:.1f})",
        )


def _predict_judges_for_task(
    task,
    judges: list[ModelSpec],
    predict_point: PredictPoint,
) -> list[tuple[dict[str, object], Point | None, str | None, str]]:
    results: list[tuple[dict[str, object], Point | None, str | None, str] | None] = [
        None
    ] * len(judges)
    start = 0
    while start < len(judges):
        judge = judges[start]
        if judge.provider.lower() == "openrouter":
            end = start + 1
            while (
                end < len(judges)
                and judges[end].provider.lower() == "openrouter"
            ):
                end += 1
            group_results = _predict_openrouter_judges(
                task, judges[start:end], predict_point
            )
            for offset, result in enumerate(group_results):
                results[start + offset] = result
            start = end
            continue

        results[start] = _predict_judge(task, judge, predict_point)
        start += 1

    return [result for result in results if result is not None]


def _predict_openrouter_judges(
    task,
    judges: list[ModelSpec],
    predict_point: PredictPoint,
) -> list[tuple[dict[str, object], Point | None, str | None, str]]:
    max_workers = min(OPENROUTER_CANDIDATE_CONCURRENCY, len(judges))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(_predict_judge, task, judge, predict_point)
            for judge in judges
        ]
        return [future.result() for future in futures]


def _predict_candidate(
    task, model: ModelSpec, predict_point: PredictPoint
) -> dict[str, object]:
    base: dict[str, object] = {
        "task_id": task.task_id,
        "image_path": task.image_path_text,
        "instruction": task.instruction,
        "model": model.name,
        "model_id": model.model_id,
        "point": None,
        "reason": None,
        "raw_text": None,
        "error": None,
        "skipped": False,
        "duration_seconds": None,
    }
    started = time.perf_counter()
    try:
        reply = predict_point(model, task.image_path, task.instruction, "candidate")
    except ModelSkipped as exc:
        base["duration_seconds"] = time.perf_counter() - started
        base["skipped"] = True
        base["error"] = str(exc)
        return base
    except Exception as exc:
        base["duration_seconds"] = time.perf_counter() - started
        base["error"] = str(exc)
        return base

    base["duration_seconds"] = time.perf_counter() - started
    parsed = parse_point_response(reply.text)
    base["raw_text"] = reply.text
    base["reason"] = parsed.reason
    if parsed.point is None:
        base["error"] = parsed.error
        return base

    base["point"] = parsed.point.as_list()
    base["_point"] = parsed.point
    return base


def _log_running(options: RunOptions, task_id: str, model: ModelSpec) -> None:
    _log(
        options,
        f"[{task_id}] Running {model.name} ({model.provider}/{model.model_id})",
    )


def _log_prediction_status(
    options: RunOptions,
    task_id: str,
    model: ModelSpec,
    prediction: dict[str, object],
) -> None:
    duration = prediction.get("duration_seconds")
    duration_text = f" in {float(duration):.2f}s" if isinstance(duration, float) else ""
    if prediction.get("skipped"):
        _log(
            options,
            f"[{task_id}] {model.name} skipped{duration_text}: {prediction['error']}",
        )
    elif prediction.get("error"):
        _log(
            options,
            f"[{task_id}] {model.name} failed{duration_text}: {prediction['error']}",
        )
    else:
        _log(options, f"[{task_id}] {model.name} finished{duration_text}")


def _write_scores_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SCORE_FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def _build_result_rows(score_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, object]]] = {}
    for row in score_rows:
        grouped.setdefault(str(row["model"]), []).append(row)

    result_rows: list[dict[str, object]] = []
    for model_name, rows in grouped.items():
        distances = [float(row["l2"]) for row in rows if row.get("l2") != ""]
        durations = [
            float(row["duration_seconds"])
            for row in rows
            if row.get("duration_seconds") not in {"", None}
        ]
        skipped = sum(1 for row in rows if row.get("skipped") is True)
        errors = sum(
            1 for row in rows if row.get("error") and row.get("skipped") is not True
        )
        status = _result_status(len(rows), len(distances), errors, skipped)
        result_rows.append(
            {
                "model": model_name,
                "status": status,
                "l2": statistics.fmean(distances) if distances else None,
                "duration_seconds": statistics.fmean(durations) if durations else None,
                "reason": _result_reason(rows, status),
            }
        )

    return sorted(result_rows, key=_result_sort_key)


def _result_status(total: int, scored: int, errors: int, skipped: int) -> str:
    if scored == total and errors == 0 and skipped == 0:
        return "ok"
    if scored > 0 and (errors or skipped):
        return "partial"
    if errors:
        return "error"
    if skipped:
        return "skipped"
    if scored == 0:
        return "unscored"
    return "ok"


def _result_reason(rows: list[dict[str, object]], status: str) -> str:
    if status == "ok":
        return ""
    if status == "partial":
        return _partial_result_reason(rows)
    for row in rows:
        if status == "skipped" and row.get("skipped") is not True:
            continue
        reason = row.get("error")
        if reason:
            return str(reason)
    return "no score"


def _partial_result_reason(rows: list[dict[str, object]]) -> str:
    errors = [
        str(row.get("error"))
        for row in rows
        if row.get("error") and row.get("skipped") is not True
    ]
    skipped = [row for row in rows if row.get("skipped") is True]
    parts: list[str] = []
    if errors:
        parts.append(f"{len(errors)} error(s)")
    if skipped:
        parts.append(f"{len(skipped)} skipped")
    prefix = ", ".join(parts) if parts else "partial"
    return f"{prefix}; first: {errors[0]}" if errors else prefix


def _result_sort_key(row: dict[str, object]) -> tuple[int, float, str]:
    l2 = row.get("l2")
    is_ranked = l2 is not None
    return (
        0 if is_ranked else 1,
        float(l2) if l2 is not None else float("inf"),
        str(row["model"]),
    )


def _progress(options: RunOptions, items, **kwargs):
    if not _show_progress(options):
        return items
    return tqdm(items, dynamic_ncols=True, **kwargs)


def _candidate_progress(options: RunOptions, total: int, task_id: str):
    if not _show_progress(options):
        return None
    desc = task_id if task_id == "Candidates" else f"{task_id} candidates"
    return tqdm(
        total=total,
        desc=desc,
        unit="call",
        leave=False,
        dynamic_ncols=True,
    )


def _update_progress(progress_bar) -> None:
    if progress_bar is not None:
        progress_bar.update(1)


def _log(options: RunOptions, message: str) -> None:
    if not options.progress:
        return
    if _show_progress(options):
        tqdm.write(message, file=sys.stderr)
        return
    print(message, file=sys.stderr)


def _show_progress(options: RunOptions) -> bool:
    return options.progress and sys.stderr.isatty()
