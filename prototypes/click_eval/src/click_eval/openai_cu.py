from __future__ import annotations

import base64
import io
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .contracts import ModelReply, Point
from .image_utils import image_size, require_pillow

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MAX_DISPLAY_WIDTH = 1280
MAX_DISPLAY_HEIGHT = 800


class OpenAIComputerUseClient:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = OPENAI_RESPONSES_URL,
        timeout_seconds: int = 90,
        max_output_tokens: int = 1024,
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is required")
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.max_output_tokens = max_output_tokens

    def predict_point(
        self,
        model_id: str,
        image_path: Path,
        instruction: str,
        purpose: str,
    ) -> ModelReply:
        original_width, original_height = image_size(image_path)
        screenshot = _scaled_screenshot(image_path, MAX_DISPLAY_WIDTH, MAX_DISPLAY_HEIGHT)
        raw = self._post(
            {
                "model": model_id,
                "max_output_tokens": self.max_output_tokens,
                "truncation": "auto",
                "tools": [
                    {
                        "type": "computer_use_preview",
                        "display_width": screenshot.width,
                        "display_height": screenshot.height,
                        "environment": "browser",
                    }
                ],
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": _computer_use_prompt(instruction, purpose),
                            },
                            {
                                "type": "input_image",
                                "image_url": screenshot.data_url,
                                "detail": "original",
                            },
                        ],
                    }
                ],
            }
        )
        point = _point_from_computer_response(raw)
        if point is None:
            return ModelReply(text=_raw_text(raw), raw=raw)
        return _reply_from_point(
            point, screenshot, original_width, original_height, raw
        )

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            self.base_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request, timeout=self.timeout_seconds
            ) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OpenAI HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"OpenAI request failed: {exc}") from exc
        return json.loads(body)


def _computer_use_prompt(instruction: str, purpose: str) -> str:
    role_line = (
        "Choose the ground-truth click point for this instruction."
        if purpose == "ground_truth"
        else "Predict the click point for this instruction."
    )
    return (
        f"{role_line}\n\n"
        "Use the computer tool and emit exactly one left-button click action at "
        "the center of the target UI element. Do not type, scroll, navigate, "
        "wait, or use any other action.\n\n"
        f"Instruction: {instruction}"
    )


class _ScaledScreenshot:
    def __init__(self, width: int, height: int, data_url: str) -> None:
        self.width = width
        self.height = height
        self.data_url = data_url


def _scaled_screenshot(path: Path, max_width: int, max_height: int) -> _ScaledScreenshot:
    Image, _, _ = require_pillow()
    with Image.open(path) as source:
        image = source.convert("RGB")
    width, height = image.size
    scale = min(max_width / width, max_height / height, 1.0)
    if scale < 1.0:
        image = image.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.Resampling.LANCZOS,
        )
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return _ScaledScreenshot(
        width=image.width,
        height=image.height,
        data_url=f"data:image/png;base64,{encoded}",
    )


def _point_from_computer_response(raw: dict[str, Any]) -> Point | None:
    for item in raw.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "computer_call":
            continue
        action = item.get("action")
        if not isinstance(action, dict) or action.get("type") != "click":
            continue
        try:
            return Point(x=float(action["x"]), y=float(action["y"]))
        except (KeyError, TypeError, ValueError):
            return None
    return None


def _reply_from_point(
    point: Point,
    screenshot: _ScaledScreenshot,
    original_width: int,
    original_height: int,
    raw: dict[str, Any],
) -> ModelReply:
    scaled = Point(
        x=point.x * original_width / screenshot.width,
        y=point.y * original_height / screenshot.height,
    )
    return ModelReply(
        text=json.dumps(
            {
                "x": scaled.x,
                "y": scaled.y,
                "reason": "OpenAI Computer Use click action",
                "display_x": point.x,
                "display_y": point.y,
                "display_width": screenshot.width,
                "display_height": screenshot.height,
                "original_width": original_width,
                "original_height": original_height,
            }
        ),
        raw=raw,
    )


def _raw_text(raw: dict[str, Any]) -> str:
    text_parts = []
    for item in raw.get("output", []):
        if not isinstance(item, dict):
            continue
        if item.get("type") == "message":
            for content in item.get("content", []):
                if isinstance(content, dict) and "text" in content:
                    text_parts.append(str(content["text"]))
    return "\n".join(text_parts) if text_parts else json.dumps(raw, ensure_ascii=False)
