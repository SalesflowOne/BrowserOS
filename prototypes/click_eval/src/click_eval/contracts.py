from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def as_list(self) -> list[float]:
        return [self.x, self.y]


@dataclass(frozen=True)
class ClickTask:
    task_id: str
    image_path: Path
    image_path_text: str
    instruction: str
    gt_point: Point | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class ModelSpec:
    name: str
    model_id: str
    provider: str = "openrouter"
    estimated_vram_gb: float | None = None
    adapter: str | None = None
    quantization: str | None = None
    allow_cpu_offload: bool = False
    dtype: str | None = None
    attn_implementation: str | None = None
    min_pixels: int | None = None
    max_pixels: int | None = None
    max_new_tokens: int | None = None
    revision: str | None = None
    use_safetensors: bool | None = None


@dataclass(frozen=True)
class ModelReply:
    text: str
    raw: dict[str, Any] | None = None


class ModelSkipped(RuntimeError):
    """Raised when a model is intentionally skipped for environment reasons."""


@dataclass(frozen=True)
class ParsedPoint:
    point: Point | None
    reason: str | None = None
    error: str | None = None
