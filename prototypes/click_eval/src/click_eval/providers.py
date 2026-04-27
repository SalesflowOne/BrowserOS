from __future__ import annotations

from pathlib import Path
from typing import Callable

from .contracts import ModelReply, ModelSpec
from .gemini import GeminiComputerUseClient
from .local_hf import LocalHFClient
from .moondream import MoondreamClient
from .openai_cu import OpenAIComputerUseClient
from .openrouter import OpenRouterClient


class ProviderClient:
    def __init__(
        self,
        timeout_seconds: int = 90,
        log_callback: Callable[[str], None] | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self._log_callback = log_callback
        self._openrouter: OpenRouterClient | None = None
        self._moondream: MoondreamClient | None = None
        self._gemini: GeminiComputerUseClient | None = None
        self._openai_cu: OpenAIComputerUseClient | None = None
        self._local_hf: LocalHFClient | None = None

    def predict_point(
        self,
        model: ModelSpec,
        image_path: Path,
        instruction: str,
        purpose: str,
    ) -> ModelReply:
        provider = model.provider.lower()
        if provider == "openrouter":
            return self._openrouter_client().predict_point(
                model.model_id, image_path, instruction, purpose
            )
        if provider == "moondream":
            return self._moondream_client().predict_point(
                model.model_id, image_path, instruction, purpose
            )
        if provider == "gemini":
            return self._gemini_client().predict_point(
                model.model_id, image_path, instruction, purpose
            )
        if provider == "openai_computer_use":
            return self._openai_cu_client().predict_point(
                model.model_id, image_path, instruction, purpose
            )
        if provider == "local_hf":
            return self._local_hf_client().predict_point(
                model, image_path, instruction, purpose
            )

        raise RuntimeError(f"Unsupported model provider: {model.provider}")

    def _openrouter_client(self) -> OpenRouterClient:
        if self._openrouter is None:
            self._openrouter = OpenRouterClient(timeout_seconds=self.timeout_seconds)
        return self._openrouter

    def _moondream_client(self) -> MoondreamClient:
        if self._moondream is None:
            self._moondream = MoondreamClient(timeout_seconds=self.timeout_seconds)
        return self._moondream

    def _gemini_client(self) -> GeminiComputerUseClient:
        if self._gemini is None:
            self._gemini = GeminiComputerUseClient(timeout_seconds=self.timeout_seconds)
        return self._gemini

    def _openai_cu_client(self) -> OpenAIComputerUseClient:
        if self._openai_cu is None:
            self._openai_cu = OpenAIComputerUseClient(
                timeout_seconds=self.timeout_seconds
            )
        return self._openai_cu

    def _local_hf_client(self) -> LocalHFClient:
        if self._local_hf is None:
            self._local_hf = LocalHFClient(
                timeout_seconds=self.timeout_seconds,
                log_callback=self._log_callback,
            )
        return self._local_hf
