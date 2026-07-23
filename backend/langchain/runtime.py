"""Shared LangChain runtime helpers for Atlas backend."""

from __future__ import annotations

import os
from typing import Any, Literal, Optional

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

ProviderName = Literal["deepseek", "qwen", "hunyuan", "gemini"]


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
    """Mirror token stream into progress events."""

    def __init__(self, request_id: str | None, stage_label: str):
        self.request_id = request_id
        self.stage_label = stage_label
        self.buffer = ""

    async def on_chat_model_start(self, serialized: dict[str, Any], messages: list[list[BaseMessage]], **kwargs: Any) -> None:
        if not self.request_id:
            return
        from backend.services import progress

        model_name = serialized.get("name") or serialized.get("id") or self.stage_label
        progress.stream_note(self.request_id, self.stage_label, {"detail": f"Starting {model_name}."})

    async def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        if not self.request_id or not token.strip():
            return
        self.buffer += token
        if len(self.buffer) < 80 and token not in "\n。.!?":
            return
        from backend.services import progress

        progress.stream_note(self.request_id, self.stage_label, {"chunk": self.buffer[-180:]})

    async def on_llm_end(self, response, **kwargs: Any) -> None:
        if self.request_id and self.buffer.strip():
            from backend.services import progress

            progress.stream_note(self.request_id, self.stage_label, {"chunk": self.buffer[-240:], "final": True})
