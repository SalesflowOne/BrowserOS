from __future__ import annotations

import ast
import json
import math
import re
from typing import Any

from .contracts import ParsedPoint, Point


def parse_point_value(value: Any) -> Point | None:
    if isinstance(value, Point):
        return value

    if isinstance(value, (list, tuple)):
        if len(value) == 1:
            return parse_point_value(value[0])
        if len(value) >= 4:
            x1 = _to_float(value[0])
            y1 = _to_float(value[1])
            x2 = _to_float(value[2])
            y2 = _to_float(value[3])
            if None not in {x1, y1, x2, y2}:
                return Point(x=(x1 + x2) / 2, y=(y1 + y2) / 2)
        if len(value) >= 2:
            direct_point = _point_from_numbers(value[0], value[1])
            if direct_point is not None:
                return direct_point
        if len(value) >= 2 and isinstance(value[0], (list, tuple)):
            first = parse_point_value(value[0])
            second = parse_point_value(value[1])
            if first is not None and second is not None:
                return Point(x=(first.x + second.x) / 2, y=(first.y + second.y) / 2)
        for item in value:
            point = parse_point_value(item)
            if point is not None:
                return point

    if isinstance(value, dict):
        if "x" in value and "y" in value:
            return _point_from_numbers(value["x"], value["y"])
        for key in (
            "point",
            "click_point",
            "coordinate",
            "coordinates",
            "point_2d",
            "bbox_2d",
            "position",
            "bbox",
            "box",
            "arguments",
        ):
            if key in value:
                point = parse_point_value(value[key])
                if point is not None:
                    return point

    return None


def parse_point_response(text: str) -> ParsedPoint:
    obj_text = _first_json_object(text)
    value_text = obj_text or _first_tagged_point(text) or _first_sequence(text)
    if value_text is None:
        return ParsedPoint(point=None, error="response did not contain a point value")

    obj, error = _parse_structured_value(value_text)
    if error is not None:
        return ParsedPoint(point=None, error=error)

    point = parse_point_value(obj)
    if point is None:
        return ParsedPoint(point=None, error="response did not contain numeric x/y")

    reason = obj.get("reason") if isinstance(obj, dict) else None
    return ParsedPoint(point=point, reason=str(reason) if reason is not None else None)


def _point_from_numbers(x_value: Any, y_value: Any) -> Point | None:
    x = _to_float(x_value)
    y = _to_float(y_value)
    if x is None or y is None:
        return None

    if not math.isfinite(x) or not math.isfinite(y):
        return None

    return Point(x=x, y=y)


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_structured_value(text: str) -> tuple[Any | None, str | None]:
    try:
        return json.loads(text), None
    except json.JSONDecodeError as json_error:
        try:
            return ast.literal_eval(text), None
        except (SyntaxError, ValueError) as literal_error:
            return (
                None,
                f"invalid JSON/Python literal: {json_error.msg}; {literal_error}",
            )


def _first_json_object(text: str) -> str | None:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced:
        return fenced.group(1)
    return _first_balanced(text, "{", "}")


def _first_sequence(text: str) -> str | None:
    starts = [(text.find("["), "[", "]"), (text.find("("), "(", ")")]
    starts = [item for item in starts if item[0] != -1]
    if not starts:
        return None
    _, opener, closer = min(starts, key=lambda item: item[0])
    return _first_balanced(text, opener, closer)


def _first_tagged_point(text: str) -> str | None:
    special = re.search(
        r"<\|(?:point|box)_start\|>\s*(.*?)\s*<\|(?:point|box)_end\|>",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if special:
        return special.group(1)

    match = re.search(
        r"<(?:point|box)[^>]*>\s*(.*?)\s*</(?:point|box)>",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    return match.group(1) if match else None


def _first_balanced(text: str, opener: str, closer: str) -> str | None:
    start = text.find(opener)
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    string_quote = ""

    for index in range(start, len(text)):
        char = text[index]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == string_quote:
                in_string = False
            continue

        if char in {"'", '"'}:
            in_string = True
            string_quote = char
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]

    return None
