"""Language normalization helpers for Atlas parsing pipelines."""

from __future__ import annotations

import asyncio

from backend.services.llm_client import call_llm

TRANSLATE_TO_ENGLISH_PROMPT = """You are a precise translation engine.

Translate the input into natural English.

Rules:
1. Preserve names, addresses, dates, numbers, URLs, and punctuation as faithfully as possible.
2. Do not summarize.
3. Do not add new information.
4. Output English only.

Input:
{text}
"""


async def translate_to_english(text: str, request_id: str | None = None) -> str:
    sample = (text or "").strip()
    if not sample:
        return ""

    from backend.services import progress
    progress.stream_note(request_id, "langchain:translate", {"detail": "Translating input to English."})

    result = await asyncio.to_thread(
        call_llm,
        messages=[{"role": "system", "content": TRANSLATE_TO_ENGLISH_PROMPT.format(text=sample[:12000])}],
        temperature=0.0,
        max_tokens=4096,
        provider="deepseek",
        model="deepseek-chat",
        request_id=request_id,
    )
    return (result.get("content", "") or "").strip() or sample
