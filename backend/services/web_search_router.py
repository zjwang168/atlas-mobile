"""Heuristics for deciding whether a smart-text request should use web search."""

from __future__ import annotations

import asyncio
import json
import re

from backend.services.llm_client import call_llm, parse_llm_response

WEB_HINTS = [
    "latest",
    "current",
    "today",
    "now",
    "recent",
    "recently",
    "this year",
    "this month",
    "who",
    "when",
    "where is",
    "where was",
    "where did",
    "where do",
    "how old",
    "married",
    "marriage",
    "wedding",
    "ceremony",
    "reception",
    "hosted",
    "host her marriage",
    "host his marriage",
    "get married",
    "结婚",
    "现在",
    "最新",
    "最近",
    "当下",
    "目前",
    "在哪",
    "哪里",
]

NO_WEB_HINTS = [
    "filming locations",
    "shooting locations",
    "取景地",
    "拍摄地",
    "location list",
    "list of places",
    "推荐",
    "景点",
    "travel guide",
]

ROUTER_PROMPT = """You are routing a place-related query.

Decide whether answering it requires live web search.

Return ONLY JSON:
{"use_web_search": true|false, "reason": "short explanation"}

Rules:
1. Use web search for current, time-sensitive, or fact-checking questions.
2. Do NOT use web search for evergreen creative/location lists, film sets,
   tourist spot suggestions, or well-known historical venues.
3. If the query is about a specific real-world event/person and the answer may
   have changed over time, use web search.

Query:
{query}

JSON:"""


def _rule_based_router(query: str) -> bool | None:
    q = (query or "").lower()
    if not q.strip():
        return False

    if any(hint in q for hint in NO_WEB_HINTS):
        return False

    # Strong real-world fact patterns that are usually time-sensitive or
    # require live verification.
    if any(token in q for token in ["marriage", "married", "wedding", "ceremony", "reception", "hosted", "get married"]):
        if any(prefix in q for prefix in ["where did", "where was", "where is", "when did", "when was", "what city", "which city"]):
            return True

    if any(hint in q for hint in WEB_HINTS):
        return True

    if "?" in q and re.search(r"\b(who|when|where|what|how|which)\b", q):
        return True

    return None


async def should_use_web_search(query: str) -> bool:
    """Decide whether to use the web-search-enabled model."""
    rule = _rule_based_router(query)
    if rule is not None:
        return rule

    sample = (query or "").strip()[:4000]
    try:
        result = await asyncio.to_thread(
            call_llm,
            messages=[
                {
                    "role": "system",
                    "content": ROUTER_PROMPT.format(query=sample),
                }
            ],
            temperature=0.0,
            max_tokens=120,
        )
        normalized = parse_llm_response(result.get("content", "{}"))
        parsed = json.loads(normalized.get("content", "{}"))
        return bool(parsed.get("use_web_search", False))
    except Exception:
        # Conservative fallback: prefer no-web unless clearly required.
        return False
