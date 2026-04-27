from __future__ import annotations

import ast
import json
import math
import re
from typing import Any

from .contracts import ParsedPoint, Point

_NUMBER_PATTERN = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)"
_POINT_KEY_PATTERN = (
    r"['\"]?(?:click_point|point_2d|POINT_2D|POINT|bbox_2d|coordinates|"
    r"coordinate|start_box|position|bbox|box|point|center)['\"]?"
)


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
            point = _point_from_numbers(value["x"], value["y"])
            if point is not None:
                return point
            for key in ("x", "y"):
                point = parse_point_value(value[key])
                if point is not None:
                    return point
        for key in (
            "point",
            "POINT",
            "click_point",
            "clickPoint",
            "target_point",
            "coordinate",
            "Coordinate",
            "coordinates",
            "point_2d",
            "POINT_2D",
            "bbox_2d",
            "position",
            "bbox",
            "box",
            "start_box",
            "arguments",
        ):
            if key in value:
                point = parse_point_value(value[key])
                if point is not None:
                    return point

    return None


def _strip_thinking(text: str) -> str:
    marker = "</think>"
    if marker in text:
        return text.split(marker, 1)[1].strip()
    return text


def parse_point_response(text: str) -> ParsedPoint:
    text = _strip_thinking(text)
    fallback_error: str | None = None

    for value_text in _structured_value_candidates(text):
        obj, error = _parse_structured_value(value_text)
        if error is not None:
            fallback_error = fallback_error or error
            point = _point_from_keyed_text(value_text)
            if point is not None:
                return ParsedPoint(point=point)
            continue

        point = parse_point_value(obj)
        if point is not None:
            reason = obj.get("reason") if isinstance(obj, dict) else None
            return ParsedPoint(
                point=point, reason=str(reason) if reason is not None else None
            )

        point = _point_from_keyed_text(value_text)
        if point is not None:
            return ParsedPoint(point=point)
        fallback_error = fallback_error or "response did not contain numeric x/y"

    point = _point_from_keyed_text(text)
    if point is not None:
        return ParsedPoint(point=point)

    return ParsedPoint(
        point=None,
        error=fallback_error or "response did not contain a point value",
    )


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


def _point_from_keyed_text(text: str) -> Point | None:
    click_call = re.search(
        rf"(?:pyautogui\.)?click\s*\(\s*(?:x\s*=\s*)?({_NUMBER_PATTERN})"
        rf"\s*,\s*(?:y\s*=\s*)?({_NUMBER_PATTERN})",
        text,
        flags=re.IGNORECASE,
    )
    if click_call:
        return _point_from_numbers(click_call.group(1), click_call.group(2))

    keyed_sequence = re.search(
        rf"(?<![A-Za-z0-9_]){_POINT_KEY_PATTERN}"
        rf"(?![A-Za-z0-9_])\s*(?::|=)?\s*['\"]?[\[(]\s*"
        rf"({_NUMBER_PATTERN}(?:\s*,\s*{_NUMBER_PATTERN}){{1,3}})",
        text,
        flags=re.IGNORECASE,
    )
    if keyed_sequence:
        numbers = re.findall(_NUMBER_PATTERN, keyed_sequence.group(1))
        point = parse_point_value(numbers[:4])
        if point is not None:
            return point

    keyed_pair = re.search(
        rf"(?<![A-Za-z0-9_]){_POINT_KEY_PATTERN}"
        rf"(?![A-Za-z0-9_])\s*(?::|=)?\s*"
        rf"({_NUMBER_PATTERN})\s*,\s*({_NUMBER_PATTERN})",
        text,
        flags=re.IGNORECASE,
    )
    if keyed_pair:
        return _point_from_numbers(keyed_pair.group(1), keyed_pair.group(2))

    x_match = re.search(
        rf"(?<![A-Za-z0-9_])['\"]?x['\"]?(?![A-Za-z0-9_])"
        rf"\s*(?::|=)\s*({_NUMBER_PATTERN})",
        text,
        flags=re.IGNORECASE,
    )
    y_match = re.search(
        rf"(?<![A-Za-z0-9_])['\"]?y['\"]?(?![A-Za-z0-9_])"
        rf"\s*(?::|=)\s*({_NUMBER_PATTERN})",
        text,
        flags=re.IGNORECASE,
    )
    if x_match and y_match:
        return _point_from_numbers(x_match.group(1), y_match.group(1))

    malformed_x_pair = re.search(
        rf"(?<![A-Za-z0-9_])['\"]?x['\"]?(?![A-Za-z0-9_])"
        rf"\s*(?::|=)\s*({_NUMBER_PATTERN})\s*,\s*({_NUMBER_PATTERN})"
        rf"(?=\s*(?:,|\}}|\]|\)|$))",
        text,
        flags=re.IGNORECASE,
    )
    if malformed_x_pair:
        return _point_from_numbers(malformed_x_pair.group(1), malformed_x_pair.group(2))

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


def _structured_value_candidates(text: str) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    def add(value: str | None) -> None:
        if value is None:
            return
        stripped = value.strip()
        if not stripped or stripped in seen:
            return
        seen.add(stripped)
        candidates.append(stripped)

    for fenced in re.finditer(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL):
        add(fenced.group(1))

    for tagged in re.finditer(
        r"<\|(?:point|box)_start\|>\s*(.*?)\s*<\|(?:point|box)_end\|>",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    ):
        add(tagged.group(1))

    for tagged in re.finditer(
        r"<(?:point|box)[^>]*>\s*(.*?)\s*</(?:point|box)>",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    ):
        add(tagged.group(1))

    for opener, closer in (("{", "}"), ("[", "]"), ("(", ")")):
        for value in _balanced_values(text, opener, closer):
            add(value)

    return candidates


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
    return _balanced_from(text, start, opener, closer)


def _balanced_values(text: str, opener: str, closer: str) -> list[str]:
    values: list[str] = []
    index = 0
    while index < len(text):
        start = text.find(opener, index)
        if start == -1:
            break
        value = _balanced_from(text, start, opener, closer)
        if value is None:
            index = start + 1
            continue
        values.append(value)
        index = start + len(value)
    return values


def _balanced_from(text: str, start: int, opener: str, closer: str) -> str | None:
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
