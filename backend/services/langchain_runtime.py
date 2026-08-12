"""LangChain runtime helpers for Atlas backend.

This module centralizes model selection, prompt execution, tool wrapping,
and streaming callbacks so the rest of the backend can stay focused on
business logic.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Literal, Optional

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import (AIMessage, BaseMessage, HumanMessage,
                                     SystemMessage)
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

ProviderName = Literal["openai_mango", "qwen", "hunyuan", "gemini", "openai"]


def _message_from_dict(message: dict[str, Any]) -> BaseMessage:
    role = message.get("role", "user")
    content = message.get("content", "")
    if role == "system":
        return SystemMessage(content=content)
    if role == "assistant":
        return AIMessage(content=content)
    return HumanMessage(content=content)


def build_prompt(messages: list[dict[str, Any]]) -> ChatPromptTemplate:
    template_messages: list[tuple[str, Any]] = []
    for message in messages:
        role = message.get("role", "user")
        if role == "system":
            template_messages.append(("system", message.get("content", "")))
        elif role == "assistant":
            template_messages.append(("assistant", message.get("content", "")))
        else:
            template_messages.append(("human", message.get("content", "")))
    return ChatPromptTemplate.from_messages(template_messages)


def normalize_messages(messages: list[dict[str, Any]]) -> list[BaseMessage]:
    return [_message_from_dict(message) for message in messages]


def _base_url_for_provider(provider: ProviderName) -> Optional[str]:
    if provider == "openai_mango":
        return os.environ.get("OPENAI_BASE_URL_MANGO", "https://api.openai.com/v1").strip() or "https://api.openai.com/v1"
    if provider == "qwen":
        return os.environ.get("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip() or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    if provider == "hunyuan":
        return os.environ.get("HUNYUAN_BASE_URL", "https://tokenhub.tencentmaas.com/v1").strip() or "https://tokenhub.tencentmaas.com/v1"
    return None


def get_chat_model(provider: ProviderName, model: str, temperature: float = 0.2):
    provider = provider.lower().strip()  # type: ignore[assignment]

    # LangSmith tracing metadata — attached to every LLM call so traces can
    # be filtered / grouped in the LangSmith dashboard.
    metadata = {
        "langsmith_tags": ["atlas", "langchain"],
        "project": os.environ.get("LANGSMITH_PROJECT", "atlas-mobile"),
    }

    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=model,
            temperature=temperature,
            max_output_tokens=8192,
            streaming=True,
            metadata=metadata,
        )

    from langchain_openai import ChatOpenAI

    api_key_env = {
        "openai_mango": "OPENAI_API_KEY_MANGO",
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
        model_kwargs={
            "metadata": metadata,
        },
    )


class ProgressStreamHandler(AsyncCallbackHandler):
    """Report model activity without streaming raw model output to clients."""

    def __init__(self, request_id: str | None, stage_label: str):
        self.request_id = request_id
        self.stage_label = stage_label

    async def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        # Model output is usually structured extraction data, not a safe or
        # comprehensible description of work in progress.
        return

    async def on_llm_end(self, response, **kwargs: Any) -> None:
        return


def add_thought(request_id: str | None, label: str, detail: str | None = None) -> None:
    if not request_id:
        return
    from backend.services import progress

    progress.stream_note(request_id, label, {"detail": detail} if detail else {})
