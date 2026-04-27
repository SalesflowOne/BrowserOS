from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .contracts import ModelReply, Point
from .image_utils import image_size


class GeminiComputerUseClient:
    def __init__(
        self,
        api_key: str | None = None,
        timeout_seconds: int = 90,
    ) -> None:
        self.api_key = (
            api_key
            or os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
        )
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY or GOOGLE_API_KEY is required")
        self.timeout_seconds = timeout_seconds

    def predict_point(
        self,
        model_id: str,
        image_path: Path,
        instruction: str,
        purpose: str,
    ) -> ModelReply:
        try:
            from google import genai
            from google.genai import types
            from google.genai.types import Content, Part
        except ImportError as exc:
            raise RuntimeError(
                "google-genai is required for provider=gemini; run `uv sync`"
            ) from exc

        width, height = image_size(image_path)
        client = genai.Client(api_key=self.api_key)
        contents = [
            Content(
                role="user",
                parts=[
                    Part(text=_computer_use_prompt(instruction, purpose)),
                    Part.from_bytes(
                        data=image_path.read_bytes(),
                        mime_type="image/png",
                    ),
                ],
            )
        ]
        config = types.GenerateContentConfig(
            tools=[
                types.Tool(
                    computer_use=types.ComputerUse(
                        environment=types.Environment.ENVIRONMENT_BROWSER,
                        excluded_predefined_functions=_excluded_functions(),
                    )
                )
            ],
            temperature=0,
        )
        _set_high_media_resolution(config, types)
        response = client.models.generate_content(
            model=model_id,
            contents=contents,
            config=config,
        )
        call = _first_function_call(response)
        raw = _raw_response(response)
        if call is None:
            return ModelReply(text=_response_text(response), raw=raw)

        point = _point_from_call(call)
        if point is None:
            return ModelReply(text=_response_text(response), raw=raw)

        scaled = _scale_computer_use_point(model_id, point, width, height)
        return ModelReply(
            text=json.dumps(
                {
                    "x": scaled.x,
                    "y": scaled.y,
                    "reason": f"Gemini Computer Use function_call {call['name']}",
                    "display_x": point.x,
                    "display_y": point.y,
                }
            ),
            raw=raw,
        )


def _computer_use_prompt(instruction: str, purpose: str) -> str:
    role_line = (
        "Choose the ground-truth click point for this instruction."
        if purpose == "ground_truth"
        else "Predict the click point for this instruction."
    )
    return (
        f"{role_line}\n\n"
        "Use the screenshot and emit exactly one Computer Use `click_at` action. "
        "Do not navigate, type, scroll, hover, or wait. Choose the center of the "
        "target UI element when possible.\n\n"
        f"Instruction: {instruction}"
    )


def _excluded_functions() -> list[str]:
    return [
        "open_web_browser",
        "wait_5_seconds",
        "go_back",
        "go_forward",
        "search",
        "navigate",
        "hover_at",
        "type_text_at",
        "key_combination",
        "scroll_document",
        "drag_and_drop",
    ]


def _set_high_media_resolution(config, types) -> None:
    media_resolution = getattr(types, "MediaResolution", None)
    if media_resolution is None:
        return
    value = (
        getattr(media_resolution, "MEDIA_RESOLUTION_HIGH", None)
        or getattr(media_resolution, "HIGH", None)
    )
    if value is not None:
        try:
            config.media_resolution = value
        except (AttributeError, TypeError, ValueError):
            return


def _first_function_call(response) -> dict[str, Any] | None:
    raw_call = _first_function_call_from_dict(_raw_response(response))
    if raw_call is not None:
        return raw_call

    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            function_call = getattr(part, "function_call", None)
            if function_call is not None:
                return _function_call_dict(function_call)
    return None


def _function_call_dict(function_call) -> dict[str, Any]:
    name = getattr(function_call, "name", None)
    args = getattr(function_call, "args", None)
    return {"name": str(name or ""), "args": _plain_dict(args)}


def _first_function_call_from_dict(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        function_call = value.get("functionCall") or value.get("function_call")
        if isinstance(function_call, dict):
            return {
                "name": str(function_call.get("name") or ""),
                "args": _plain_dict(function_call.get("args")),
            }
        for child in value.values():
            found = _first_function_call_from_dict(child)
            if found is not None:
                return found
    if isinstance(value, list):
        for child in value:
            found = _first_function_call_from_dict(child)
            if found is not None:
                return found
    return None


def _point_from_call(call: dict[str, Any]) -> Point | None:
    args = call.get("args")
    if not isinstance(args, dict):
        return None
    try:
        return Point(x=float(args["x"]), y=float(args["y"]))
    except (KeyError, TypeError, ValueError):
        return None


def _scale_computer_use_point(
    model_id: str, point: Point, width: int, height: int
) -> Point:
    if model_id.startswith("gemini-3-"):
        return point
    return Point(x=point.x / 1000 * width, y=point.y / 1000 * height)


def _response_text(response) -> str:
    parts = []
    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            text = getattr(part, "text", None)
            if text:
                parts.append(str(text))
    if parts:
        return "\n".join(parts)
    return json.dumps(_raw_response(response), ensure_ascii=False)


def _raw_response(response) -> dict[str, Any]:
    for method_name in ("to_json_dict", "model_dump", "dict"):
        method = getattr(response, method_name, None)
        if method is None:
            continue
        try:
            value = method()
        except TypeError:
            continue
        if isinstance(value, dict):
            return _plain_dict(value)
    return {"repr": repr(response)}


def _plain_dict(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _plain_dict(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain_dict(item) for item in value]
    if isinstance(value, tuple):
        return [_plain_dict(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    try:
        return dict(value)
    except (TypeError, ValueError):
        return repr(value)
