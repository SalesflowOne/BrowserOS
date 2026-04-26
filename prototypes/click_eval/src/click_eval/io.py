from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from .contracts import ClickTask, ModelSpec
from .parsing import parse_point_value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                rows.append(json.loads(stripped))
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSONL: {exc}") from exc
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def load_tasks(path: Path) -> list[ClickTask]:
    rows = read_jsonl(path)
    tasks: list[ClickTask] = []
    base = path.parent
    for index, row in enumerate(rows, start=1):
        try:
            task_id = str(row["task_id"])
            image_path_text = str(row["image_path"])
            instruction = str(row["instruction"])
        except KeyError as exc:
            raise ValueError(f"{path}:{index}: missing required field {exc}") from exc

        image_path = Path(image_path_text)
        if not image_path.is_absolute():
            image_path = base / image_path

        gt_point = parse_point_value(row.get("gt_point"))
        tasks.append(
            ClickTask(
                task_id=task_id,
                image_path=image_path,
                image_path_text=image_path_text,
                instruction=instruction,
                gt_point=gt_point,
                raw=dict(row),
            )
        )
    return tasks


def load_model_config(path: Path) -> tuple[ModelSpec | None, list[ModelSpec], dict[str, Any]]:
    config = json.loads(path.read_text(encoding="utf-8"))
    judge = None
    if config.get("judge_model"):
        judge = _model_spec(config["judge_model"], default_name="judge")

    candidate_entries = config.get("candidate_models") or []
    candidates = [_model_spec(entry) for entry in candidate_entries]
    if not candidates:
        raise ValueError(f"{path}: candidate_models must contain at least one model")

    return judge, candidates, config


def _model_spec(entry: Any, default_name: str | None = None) -> ModelSpec:
    if isinstance(entry, str):
        return ModelSpec(name=default_name or entry, model_id=entry)
    if isinstance(entry, dict):
        model_id = str(entry.get("model") or entry.get("id") or "")
        if not model_id:
            raise ValueError(f"model entry is missing model/id: {entry}")
        return ModelSpec(
            name=str(entry.get("name") or default_name or model_id),
            model_id=model_id,
            provider=str(entry.get("provider") or "openrouter"),
            estimated_vram_gb=_optional_float(
                entry.get("estimated_vram_gb") or entry.get("vram_gb")
            ),
            adapter=_optional_string(entry.get("adapter")),
            quantization=_optional_string(entry.get("quantization")),
            allow_cpu_offload=_optional_bool(entry.get("allow_cpu_offload")) or False,
            dtype=_optional_string(entry.get("dtype")),
            attn_implementation=_optional_string(entry.get("attn_implementation")),
            min_pixels=_optional_int(entry.get("min_pixels") or entry.get("image_min_pixels")),
            max_pixels=_optional_int(entry.get("max_pixels") or entry.get("image_max_pixels")),
            max_new_tokens=_optional_int(entry.get("max_new_tokens")),
            revision=_optional_string(entry.get("revision")),
            use_safetensors=_optional_bool(entry.get("use_safetensors")),
        )
    raise ValueError(f"invalid model entry: {entry!r}")


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _optional_string(value: Any) -> str | None:
    if value is None or value == "":
        return None
    return str(value)


def _optional_bool(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)
