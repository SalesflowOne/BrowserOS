from __future__ import annotations

from pathlib import Path
from typing import Any

from .contracts import Point
from .image_utils import require_pillow

COLORS = [
    (56, 132, 255),
    (255, 149, 0),
    (175, 82, 222),
    (255, 45, 85),
    (90, 200, 250),
    (255, 204, 0),
]
GT_COLOR = (20, 180, 70)
JUDGE_COLORS = [
    (0, 128, 128),
    (180, 90, 0),
    (120, 80, 220),
]


def annotate_image(
    image_path: Path,
    output_path: Path,
    gt_point: Point | None,
    predictions: list[dict[str, Any]],
    judge_points: list[dict[str, Any]] | None = None,
) -> None:
    Image, ImageDraw, ImageFont = require_pillow()
    with Image.open(image_path) as source:
        image = source.convert("RGB")

    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    legend_lines: list[tuple[str, tuple[int, int, int]]] = []

    if gt_point is not None:
        legend_lines.append(("GT", GT_COLOR))
        _draw_marker(draw, gt_point, GT_COLOR, "GT")

    for index, judge in enumerate(judge_points or []):
        color = JUDGE_COLORS[index % len(JUDGE_COLORS)]
        label = str(judge.get("label") or f"GT{index + 1}")
        model_name = str(judge.get("model") or f"judge-{index + 1}")
        point = judge.get("point")
        l2 = judge.get("l2")
        if isinstance(point, Point):
            _draw_marker(draw, point, color, label)
            distance = f"{float(l2):.1f}px" if l2 is not None else "n/a"
            legend_lines.append((f"{label} {model_name}: {distance}", color))
        else:
            error = str(judge.get("error") or "no point")
            legend_lines.append((f"{label} {model_name}: {_short_text(error)}", color))

    for index, prediction in enumerate(_sort_predictions_by_l2(predictions)):
        color = COLORS[index % len(COLORS)]
        model_name = str(prediction["model"])
        point = prediction.get("point")
        l2 = prediction.get("l2")
        if isinstance(point, Point):
            _draw_marker(draw, point, color, str(index + 1))
            distance = f"{float(l2):.1f}px" if l2 is not None else "n/a"
            legend_lines.append((f"{index + 1} {model_name}: {distance}", color))
        else:
            legend_lines.append((f"{index + 1} {model_name}: error", color))

    _draw_legend(draw, legend_lines, font)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def _sort_predictions_by_l2(predictions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def sort_key(item: tuple[int, dict[str, Any]]) -> tuple[int, float, int]:
        index, prediction = item
        l2 = prediction.get("l2")
        if l2 is None:
            return (1, 0.0, index)
        try:
            return (0, float(l2), index)
        except (TypeError, ValueError):
            return (1, 0.0, index)

    return [prediction for _, prediction in sorted(enumerate(predictions), key=sort_key)]


def _draw_marker(draw, point: Point, color: tuple[int, int, int], label: str) -> None:
    x = int(round(point.x))
    y = int(round(point.y))
    radius = 8
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=color, width=3)
    draw.line((x - 12, y, x + 12, y), fill=color, width=2)
    draw.line((x, y - 12, x, y + 12), fill=color, width=2)
    draw.text((x + 10, y + 8), label, fill=color)


def _draw_legend(draw, lines, font) -> None:
    if not lines:
        return
    padding = 6
    line_height = 14
    width = max(90, max(len(text) for text, _ in lines) * 7 + padding * 2)
    height = padding * 2 + line_height * len(lines)
    draw.rectangle((0, 0, width, height), fill=(255, 255, 255), outline=(30, 30, 30))
    for index, (text, color) in enumerate(lines):
        y = padding + index * line_height
        draw.text((padding, y), text, fill=color, font=font)


def _short_text(text: str, max_chars: int = 80) -> str:
    compact = " ".join(text.split())
    if len(compact) <= max_chars:
        return compact
    return compact[: max_chars - 1] + "..."
