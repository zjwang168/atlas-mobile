"""Shared LangChain runtime helpers for Atlas backend."""

from __future__ import annotations

import os
import time
from typing import Any, Literal, Optional

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

ProviderName = Literal["deepseek", "qwen", "hunyuan", "gemini", "openai_mango"]


def normalize_messages(messages: list[dict[str, Any]]) -> list[BaseMessage]:
    normalized: list[BaseMessage] = []
    for message in messages:
        role = message.get("role", "user")
        content = message.get("content", "")
        if role == "system":
            normalized.append(SystemMessage(content=content))
        elif role == "assistant":
            normalized.append(AIMessage(content=content))
        else:
            normalized.append(HumanMessage(content=content))
    return normalized


def _base_url_for_provider(provider: ProviderName) -> Optional[str]:
    if provider == "openai_mango":
        return os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip() or "https://api.openai.com/v1"
    if provider == "deepseek":
        return os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").strip() or "https://api.deepseek.com/v1"
    if provider == "qwen":
        return os.environ.get("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip() or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    if provider == "hunyuan":
        return os.environ.get("HUNYUAN_BASE_URL", "https://tokenhub.tencentmaas.com/v1").strip() or "https://tokenhub.tencentmaas.com/v1"
    return None


def get_chat_model(provider: ProviderName, model: str, temperature: float = 0.2):
    provider = provider.lower().strip()  # type: ignore[assignment]
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=model, temperature=temperature, max_output_tokens=8192, streaming=True)

    from langchain_openai import ChatOpenAI

    api_key_env = {
        "openai_mango": "OPENAI_API_KEY_MANGO",
        "deepseek": "DEEPSEEK_API_KEY",
        "qwen": "QWEN_API_KEY",
        "hunyuan": "HUNYUAN_API_KEY",
    }[provider]  # type: ignore[index]
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        max_tokens=8192,
        api_key=os.environ.get(api_key_env, ""),
        base_url=_base_url_for_provider(provider),  # type: ignore[arg-type]
        streaming=True,
    )


class ProgressStreamHandler(AsyncCallbackHandler):
    """Report model activity without exposing its raw structured output."""

    def __init__(self, request_id: str | None, stage_label: str):
        self.request_id = request_id
        self.stage_label = stage_label
        self._last_update_at = 0.0
        self._update_count = 0

    async def on_chat_model_start(self, serialized: dict[str, Any], messages: list[list[BaseMessage]], **kwargs: Any) -> None:
        if not self.request_id:
            return
        from backend.services import progress

        progress.stream_note(self.request_id, self.stage_label, {"stage": "model_started"})

    async def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        # Keep the UI alive during long structured responses without exposing
        # JSON tokens or hidden chain-of-thought content.
        now = time.monotonic()
        if not self.request_id or now - self._last_update_at < 1.4:
            return
        self._last_update_at = now
        self._update_count += 1
        details = (
            "Reviewing the source context.",
            "Comparing place names with nearby clues.",
            "Checking the strongest location references.",
        )
        from backend.services import progress
        progress.stream_note(self.request_id, self.stage_label, {
            "stage": "model_progress",
            "detail": details[(self._update_count - 1) % len(details)],
        })

    async def on_llm_end(self, response, **kwargs: Any) -> None:
        return
