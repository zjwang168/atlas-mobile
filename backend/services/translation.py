"""Language normalization helpers for Atlas parsing pipelines."""

from __future__ import annotations

import asyncio
import re

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

# The extraction prompts already understand Latin-script travel content and
# require English output. Calling a translation model for English (or a URL,
# address, and numbers) only adds a full serial LLM round trip. Non-Latin
# scripts still need normalization before entity extraction/geocoding.
_NON_LATIN_SCRIPT_RE = re.compile(
    r"[\u0400-\u052f\u0590-\u08ff\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]"
)


def needs_english_translation(text: str) -> bool:
    """Return whether text contains scripts that need English normalization."""
    return bool(_NON_LATIN_SCRIPT_RE.search(text or ""))


async def translate_to_english(text: str, request_id: str | None = None) -> str:
    sample = (text or "").strip()
    if not sample:
        return ""
    if not needs_english_translation(sample):
        return sample

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
