"""Extract place action cards from assistant markdown using DeepSeek."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from backend.services.llm_client import call_llm, parse_llm_response

RECOMMEND_BLOCK_RE = re.compile(
    r"(?:^|\n)\s*(?:#{1,6}\s*)?.*?(?:推荐|Recommendation|Recommend)\s*\d+\s*[:：][\s\S]*?(?=(?:\n\s*(?:#{1,6}\s*)?.*?(?:推荐|Recommendation|Recommend)\s*\d+\s*[:：])|$)",
    re.IGNORECASE,
)

NUMBERED_BLOCK_RE = re.compile(
    r"(?:^|\n)\s*(?:#{1,6}\s*)?.*?(?:\d+️⃣|\d+\s*[.)]|[①②③④⑤⑥⑦⑧⑨⑩])[\s\S]*?(?=(?:\n\s*(?:#{1,6}\s*)?.*?(?:\d+️⃣|\d+\s*[.)]|[①②③④⑤⑥⑦⑧⑨⑩]))|$)",
    re.IGNORECASE,
)


def _strip_markdown(text: str) -> str:
    return (
        text.replace("**", "")
        .replace("__", "")
        .replace("`", "")
        .replace("【", "")
        .replace("】", "")
        .replace("（", "(")
        .replace("）", ")")
    )


def _parse_float_pair(text: str) -> tuple[float, float] | None:
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)", text)
    if not match:
        return None
    try:
        return float(match.group(1)), float(match.group(2))
    except Exception:
        return None


def _heuristic_extract_cards(text: str) -> list[dict[str, Any]]:
    cleaned = _strip_markdown(text)
    blocks = RECOMMEND_BLOCK_RE.findall(cleaned) or NUMBERED_BLOCK_RE.findall(cleaned)
    if not blocks and ("坐标" not in cleaned and "coordinates" not in cleaned.lower()):
        return []
    if not blocks:
        # Fallback: split on paragraphs and keep those with coordinates.
        blocks = [part for part in re.split(r"\n\s*\n", cleaned) if _parse_float_pair(part)]

    cards: list[dict[str, Any]] = []
    for block in blocks:
        title_line = block.splitlines()[0].strip()
        name_match = (
            re.search(r"(?:推荐|Recommendation|Recommend)\s*\d+\s*[:：]\s*(.+)", title_line, re.IGNORECASE)
            or re.search(r"(?:推荐|Recommendation|Recommend)\s*\d+\s+(.+)", title_line, re.IGNORECASE)
            or re.search(r"(?:\d+️⃣|\d+\s*[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)", title_line)
        )
        if not name_match:
            # Use the first non-empty line as a title fallback.
            for candidate in block.splitlines():
                candidate = candidate.strip()
                if candidate and not candidate.startswith("-") and not candidate.startswith("—"):
                    name_match = re.match(r"(.+)", candidate)
                    if name_match:
                        break
        if not name_match:
            continue

        name = name_match.group(1).strip()
        name = re.sub(r"^[^\w\u4e00-\u9fa5]+", "", name).strip()
        name = re.sub(r"[。.!！?？]+$", "", name).strip()

        coord = None
        for line in block.splitlines():
            line_clean = _strip_markdown(line)
            if "坐标" in line_clean or "coordinates" in line_clean.lower():
                coord = _parse_float_pair(line_clean)
                if coord:
                    break
        if not coord:
            coord = _parse_float_pair(block)
        if not coord:
            continue

        subtitle_match = re.search(r"地址\s*[:：]\s*([^\n]+)", block, re.IGNORECASE)
        description_match = re.search(r"简介\s*[:：]\s*([\s\S]*?)(?:\n\s*[-*•]|$)", block, re.IGNORECASE)
        subtitle = subtitle_match.group(1).strip() if subtitle_match else ""
        description = description_match.group(1).strip() if description_match else subtitle
        if not subtitle and description:
            subtitle = description[:120]

        cards.append(
            {
                "places": [
                    {
                        "name": name,
                        "latitude": coord[0],
                        "longitude": coord[1],
                        "subtitle": subtitle,
                        "category": "Place",
                        "description": description,
                    }
                ],
                "status": "pending",
            }
        )
        if len(cards) >= 3:
            break
    return cards

PLACE_CARD_EXTRACTION_PROMPT = """You are extracting place action cards from a travel chat assistant reply.

Your task:
1. Read the assistant reply.
2. Find all real-world places that the assistant is explicitly recommending, asking the user to add, or presenting for map pinning / saving.
3. Return ONLY valid JSON in this exact shape:
{{"cards":[{{"places":[{{"name":"...","latitude":0,"longitude":0,"subtitle":"...","category":"...","description":"..."}}],"status":"pending"}}]}}

Rules:
1. Only extract places from the current assistant reply, not from chat history.
2. Support any markdown format: headings, bullets, bold text, emojis, fenced code blocks, plain text.
3. Prefer explicit coordinates if present.
4. If a reply contains multiple recommended places, return one card per place.
5. Limit to at most 3 cards.
6. If a place cannot be identified with enough confidence, omit it.
7. Keep the place name clean and human-readable.
8. Return an empty cards array if there are no actionable places.

Assistant reply:
{text}

JSON:
"""


def _normalize_card(card: dict[str, Any]) -> dict[str, Any] | None:
    places = card.get("places") or []
    if not places:
        return None

    normalized_places = []
    for place in places[:1]:
        name = str(place.get("name", "")).strip()
        if not name:
            continue
        try:
            latitude = float(place.get("latitude", 0) or 0)
            longitude = float(place.get("longitude", 0) or 0)
        except Exception:
            continue
        normalized_places.append({
            "name": name,
            "latitude": latitude,
            "longitude": longitude,
            "subtitle": str(place.get("subtitle", "") or "").strip(),
            "category": str(place.get("category", "") or "").strip(),
            "description": str(place.get("description", "") or "").strip(),
        })

    if not normalized_places:
        return None

    return {
        "places": normalized_places,
        "status": str(card.get("status") or "pending"),
    }


async def extract_place_cards(text: str, request_id: str | None = None) -> list[dict[str, Any]]:
    """Return up to 3 actionable place cards from a markdown assistant reply."""
    content = (text or "").strip()
    if not content:
        return []

    heuristic_cards = _heuristic_extract_cards(content)
    if heuristic_cards:
        return heuristic_cards[:3]

    model_name = os.environ.get("PLACE_CARD_EXTRACT_MODEL") or os.environ.get("OPENAI_MODEL_MANGO") or "gpt-4o-mini"

    prompt = PLACE_CARD_EXTRACTION_PROMPT.format(text=content[:12000])

    result = await call_llm(
        messages=[
            {
                "role": "system",
                "content": prompt,
            }
        ],
        temperature=0.0,
        max_tokens=1500,
        provider="openai_mango",
        model=model_name,
        request_id=request_id,
    )

    normalized = parse_llm_response(result.get("content", ""))
    try:
        parsed = json.loads(normalized.get("content", "{}"))
    except Exception:
        return []

    raw_cards = parsed.get("cards") or []
    cards: list[dict[str, Any]] = []
    for raw_card in raw_cards:
        normalized_card = _normalize_card(raw_card if isinstance(raw_card, dict) else {})
        if normalized_card:
            cards.append(normalized_card)
        if len(cards) >= 3:
            break
    return cards
