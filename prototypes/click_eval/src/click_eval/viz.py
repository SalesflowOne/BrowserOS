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
    gt_point: Point,
    predictions: list[dict[str, Any]],
    judge_points: list[dict[str, Any]] | None = None,
) -> None:
    Image, ImageDraw, ImageFont = require_pillow()
    with Image.open(image_path) as source:
        image = source.convert("RGB")

    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    legend_lines: list[tuple[str, tuple[int, int, int]]] = [("GT", GT_COLOR)]

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
            legend_lines.append((f"{label} {model_name}: error", color))

    for index, prediction in enumerate(predictions):
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


def _draw_marker(draw, point: Point, color: tuple[int, int, int], label: str) -> None:
    x = int(round(point.x))
    y = int(round(point.y))
    radius = 8
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=color, width=3)
    draw.line((x - 12, y, x + 12, y), fill=color, width=2)
    draw.line((x, y - 12, x, y + 12), fill=color, width=2)
    draw.text((x + 10, y + 8), label, fill=color)


def _draw_legend(draw, lines, font) -> None:
    padding = 6
    line_height = 14
    width = max(90, max(len(text) for text, _ in lines) * 7 + padding * 2)
    height = padding * 2 + line_height * len(lines)
    draw.rectangle((0, 0, width, height), fill=(255, 255, 255), outline=(30, 30, 30))
    for index, (text, color) in enumerate(lines):
        y = padding + index * line_height
        draw.text((padding, y), text, fill=color, font=font)
