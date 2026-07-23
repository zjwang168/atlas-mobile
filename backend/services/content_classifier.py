"""Lightweight content classifier for location parsing.

Decides whether a text block is better handled by:
- named_poi: entity extraction + hierarchy filtering
- address_first: address-heavy discovery / geocode-first flow

This is used by the scrape and image pipelines so the app can route content to
the most reliable parser without exposing that complexity to the UI.
"""

from __future__ import annotations

import asyncio
import json
import re

from backend.services.llm_client import call_llm, parse_llm_response

CLASSIFIER_PROMPT = """You are classifying content for a travel-location parser.

Choose the best mode:
- "named_poi": the content contains specific place names, venues, landmarks,
  neighborhoods, or destinations people would search for by name.
- "address_first": the content is mostly street addresses, address fragments,
  PO boxes, intersections, or weak place references that need address-based
  geocoding rather than name-based entity linking.

Output ONLY valid JSON in this shape:
{"mode":"named_poi"|"address_first","confidence":0.0,"reason":"short explanation"}

Guidance:
1. Prefer "address_first" when the content contains multiple street numbers,
   street abbreviations (St, Rd, Ave, Blvd, Dr, Ln), or explicit mailing
   addresses.
2. Prefer "named_poi" when the content names real venues or landmarks like
   "abc sports center", "Golden Gate Bridge", "The Bund", or "Tokyo Tower".
3. If both are present, choose the dominant signal.
4. Return English labels only.

Text:
{text}

JSON:"""

ADDRESS_HINT_RE = re.compile(
    r"\b\d{1,6}\s+[\w.'-]+(?:\s+[\w.'-]+){0,5}\s+"
    r"(?:st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|"
    r"pkwy|parkway|hwy|highway|ct|court|pl|place|square|sq)\b",
    re.IGNORECASE,
)


def _heuristic_mode(text: str) -> str:
    """Fallback heuristic when the LLM output is unavailable."""
    address_hits = len(ADDRESS_HINT_RE.findall(text))
    if address_hits >= 2:
        return "address_first"

    lower = text.lower()
    if any(token in lower for token in ["address", "street", "road", "avenue", "suite", "apt"]):
        return "address_first"

    return "named_poi"


async def classify_location_content(text: str, source_type: str = "generic") -> str:
    """Classify content into named POI vs address-first mode."""
    sample = (text or "").strip()[:8000]
    if not sample:
        return "named_poi"

    # Short pure-address snippets are better handled by the address-first path.
    if ADDRESS_HINT_RE.search(sample) and len(sample) < 1200:
        return "address_first"

    try:
        result = await asyncio.to_thread(
            call_llm,
            messages=[
                {
                    "role": "system",
                    "content": CLASSIFIER_PROMPT.format(text=sample),
                }
            ],
            temperature=0.0,
            max_tokens=200,
        )
        content = result.get("content", "{}")
        normalized = parse_llm_response(content)
        parsed = json.loads(normalized.get("content", "{}"))
        mode = parsed.get("mode", "named_poi")
        if mode not in {"named_poi", "address_first"}:
            return _heuristic_mode(sample)
        return mode
    except Exception:
        return _heuristic_mode(sample)

