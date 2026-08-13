"""Find Image Places service — Mango vision model → structured place result.

Flow:
1. Send the uploaded image to the Mango-configured OpenAI model through LangChain.
2. Ask for exactly one structured place result with:
   - landmark name
   - geographic coordinates
   - confidence score
3. Return a ParseResponse-compatible payload for the Save Places screen.

All outputs are in English.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import time
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage

from backend.services.langchain_runtime import get_chat_model

logger = logging.getLogger("atlas.find_image_places")

# Keep single-photo recognition on the direct Mango/OpenAI credentials. The
# legacy OPENAI_* values point at a retired proxy and must not be used here.
OPENAI_VISION_MODEL = os.environ.get(
    "OPENAI_MODEL_MANGO_FOR_IMGAE_RECOGNITION",
    "gpt-4o",
).strip() or "gpt-4o"
OPENAI_VISION_TEMPERATURE = float(os.environ.get("OPENAI_VISION_TEMPERATURE", "0.1"))


async def find_image_place(image_base64: str, request_id: str | None = None) -> dict:
    """Identify a place from one image using the Mango vision model."""
    from backend.services import progress

    progress.stream_note(request_id, "image:vision", {"stage": "started"})
    vision_started_at = time.perf_counter()
    place = await _call_gpt4o_vision(image_base64)
    vision_ms = round((time.perf_counter() - vision_started_at) * 1000)
    logger.info("[FindImagePlaces] vision request completed in %sms", vision_ms)
    progress.stream_note(request_id, "image:vision", {"stage": "completed", "latency_ms": vision_ms})
    if place:
        confidence = float(place.get("confidence", 0) or 0)
        name = str(place.get("name") or "Unknown Location").strip() or "Unknown Location"
        latitude = float(place.get("latitude", 0) or 0)
        longitude = float(place.get("longitude", 0) or 0)
        tagline = str(place.get("region_tagline") or "").strip() or None
        progress.stream_note(request_id, "place:identified", {"name": name})
        progress.stream_note(request_id, "image:location", {"stage": "candidate_ready", "region": name, "tagline": tagline})
        return _build_response(
            name=name,
            latitude=latitude,
            longitude=longitude,
            confidence=confidence,
            subtitle="",
            source="mango_vision",
        )

    progress.stream_note(request_id, "image:location", {"stage": "no_candidate"})
    return _build_response(
        name="Unknown Location",
        latitude=0,
        longitude=0,
        confidence=0,
        subtitle="I could not confidently identify the place in this image.",
        source="unknown",
    )


async def _call_gpt4o_vision(image_base64: str) -> Optional[dict]:
    """Call Mango's OpenAI-compatible vision endpoint and parse JSON."""
    api_key = os.environ.get("OPENAI_API_KEY_MANGO", "").strip()
    if not api_key:
        logger.warning("[FindImagePlaces] OPENAI_API_KEY_MANGO not set")
        return None

    model = get_chat_model(
        provider="openai_mango",
        model=OPENAI_VISION_MODEL,
        temperature=OPENAI_VISION_TEMPERATURE,
    )

    system_prompt = (
        "You identify geographic places from photos.\n"
        "Return ONLY valid JSON with this exact schema:\n"
        '{"name":"place name","latitude":0.0,"longitude":0.0,"confidence":0.0,"region_tagline":"2-4 English words"}\n\n'
        "Rules:\n"
        "1. If you can identify the landmark or place, include the best known coordinates.\n"
        "2. confidence must be a number from 0 to 1.\n"
        "3. If unsure, still return your best guess, but lower confidence.\n"
        "4. Do not include markdown or any text outside JSON."
        "\n5. region_tagline must be exactly 2-4 refined English words that evoke the location."
    )

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(
            content=[
                {
                    "type": "text",
                    "text": (
                        "Identify the place in this image and return the JSON fields "
                        "name, latitude, longitude, and confidence."
                    ),
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": _to_data_url(image_base64),
                    },
                },
            ]
        ),
    ]

    try:
        response = await asyncio.to_thread(model.invoke, messages)
        content = getattr(response, "content", response)
        if isinstance(content, list):
            text_chunks = []
            for chunk in content:
                if isinstance(chunk, dict) and "text" in chunk:
                    text_chunks.append(str(chunk["text"]))
            content = " ".join(text_chunks) if text_chunks else str(content)

        cleaned = _clean_json_text(str(content))
        result = json.loads(cleaned)

        if not isinstance(result, dict):
            return None

        if "name" not in result or "latitude" not in result or "longitude" not in result:
            return None

        logger.info(
            "[FindImagePlaces] Mango vision result: name=%s confidence=%s",
            result.get("name"),
            result.get("confidence"),
        )
        return result

    except json.JSONDecodeError as exc:
        logger.warning("[FindImagePlaces] Mango vision JSON parse error: %s", exc)
        return None
    except Exception as exc:
        logger.warning("[FindImagePlaces] Mango vision call failed: %s", exc)
        return None


def _to_data_url(image_base64: str) -> str:
    cleaned = (image_base64 or "").strip()
    if cleaned.startswith("data:"):
        return cleaned
    return f"data:image/jpeg;base64,{cleaned}"


def _clean_json_text(value: str) -> str:
    cleaned = value.strip()
    if cleaned.startswith("```"):
        lines = [line for line in cleaned.splitlines() if not line.startswith("```")]
        cleaned = "\n".join(lines).strip()

    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if match:
        return match.group(0)
    return cleaned


def _build_response(
    name: str,
    latitude: float,
    longitude: float,
    confidence: float,
    subtitle: str,
    source: str,
) -> dict:
    """Build standardized ParseResponse-compatible dict."""
    return {
        "title": name,
        "locations": [
            {
                "name": name,
                "latitude": latitude,
                "longitude": longitude,
                "description": subtitle,
                "full_address": "",
                "category": "landmark",
                "sentiment": None,
                "source": source,
                "confidence": confidence,
            }
        ],
        "route": {
            "ordered_locations": [],
            "total_distance_km": 0.0,
            "segments": [],
        },
        "removed_noise": [],
        "source_type": "find_image_places",
        "inferred_region": None,
    }
