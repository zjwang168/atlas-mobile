"""Instagram Reel place extraction backed by Apify's official Reel actor.

The first pass uses the public caption, hashtags, creator, and tagged location.
Audio transcription is requested only when those metadata do not identify a
specific place, because Apify bills transcript generation separately.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from backend.services.extraction_pipeline import ExtractionPipeline
from backend.services.geocoder import batch_geocode
from backend.services.translation import translate_to_english
from backend.services.universal_web_content import _assert_public_host

logger = logging.getLogger("atlas.instagram_reels")

INSTAGRAM_REELS_ACTOR_ID = os.environ.get("INSTAGRAM_REELS_APIFY_ACTOR", "apify/instagram-reel-scraper")
INSTAGRAM_REELS_METADATA_TIMEOUT_S = float(os.environ.get("INSTAGRAM_REELS_METADATA_TIMEOUT_S", "45"))
INSTAGRAM_REELS_TRANSCRIPT_TIMEOUT_S = float(os.environ.get("INSTAGRAM_REELS_TRANSCRIPT_TIMEOUT_S", "90"))
_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
_INSTAGRAM_URL_RE = re.compile(r"https?://(?:www\.)?(?:instagram\.com|instagr\.am)/", re.IGNORECASE)


async def parse_instagram_reel_url(url: str, request_id: str | None = None) -> dict:
    """Parse one public Instagram Reel into Atlas's standard place response."""
    reel_url = await _prepare_reel_url(url)

    from backend.services import progress

    progress.stream_note(request_id, "instagram:fetch", {"detail": "Collecting the public Reel caption and metadata."})
    item = await _fetch_instagram_reel(reel_url, include_transcript=False)
    title, source_text = _source_text_from_item(item, reel_url)
    progress.mark(request_id, "source_fetched", "Source prepared.", {"title": title, "source_type": "instagram_reels"})
    progress.stream_note(request_id, "instagram:caption", {"detail": "Reel caption, hashtags, and tagged location collected."})

    extracted: dict[str, Any] = {}
    if source_text:
        english_text = await translate_to_english(source_text, request_id=request_id)
        progress.stream_note(request_id, "instagram:deepseek", {"detail": "Extracting places from the Reel context."})
        extracted = await ExtractionPipeline.extract(english_text, source_type="instagram_reels", request_id=request_id)

    # Transcript generation is a paid actor add-on, so ask for it only when
    # the public metadata did not yield a concrete POI or neighborhood.
    if _needs_transcript(extracted):
        progress.stream_note(request_id, "instagram:transcribe", {"detail": "The caption was not specific enough; requesting the Reel audio transcript."})
        transcribed_item = await _fetch_instagram_reel(reel_url, include_transcript=True)
        _, enriched_text = _source_text_from_item(transcribed_item, reel_url)
        if enriched_text and enriched_text != source_text:
            progress.stream_note(request_id, "instagram:transcript", {"detail": "Transcript ready; checking spoken place references."})
            english_text = await translate_to_english(enriched_text, request_id=request_id)
            progress.stream_note(request_id, "instagram:deepseek", {"detail": "Extracting places from the caption and transcript."})
            extracted = await ExtractionPipeline.extract(english_text, source_type="instagram_reels", request_id=request_id)

    if not source_text and not extracted:
        raise ValueError("This Instagram Reel has no public caption or transcript text to analyze.")

    location_names = extracted.get("locations", [])
    progress.stream_identified_places(request_id, location_names)
    progress.stream_note(request_id, "instagram:geocode", {"detail": f"Geocoding {len(location_names)} places."})
    inferred_region = extracted.get("inferred_region")
    if inferred_region:
        progress.stream_note(request_id, "analysis:region", {
            "region": inferred_region,
            "tagline": extracted.get("region_tagline"),
        })

    geocoded = await batch_geocode(_build_geocode_queries(location_names, inferred_region), city_name=inferred_region)
    locations: list[dict[str, Any]] = []
    removed_noise = list(extracted.get("removed_noise", []))
    for location, geo in zip(location_names, geocoded):
        if not geo:
            continue
        if not _matches_inferred_region(geo, inferred_region):
            removed_noise.append({
                "name": location.get("name", ""),
                "reason": f"Geocoding result is outside the Reel's inferred region: {inferred_region}",
            })
            continue
        locations.append({
            "name": location.get("name", geo.get("name", "")),
            "latitude": geo.get("latitude", 0),
            "longitude": geo.get("longitude", 0),
            "full_address": geo.get("full_address", ""),
            "sentiment": location.get("sentiment"),
            "description": location.get("description"),
            "category": location.get("category"),
            "is_exact": geo.get("is_exact", False),
            "confidence": location.get("confidence"),
            "source": "instagram_reels",
        })

    return {
        "title": title,
        "locations": locations,
        "route": {"ordered_locations": [], "total_distance_km": 0.0, "segments": []},
        "removed_noise": removed_noise,
        "removed_hierarchy": extracted.get("removed_hierarchy", []),
        "inferred_region": inferred_region,
        "source_type": "instagram_reels",
    }


async def _prepare_reel_url(value: str) -> str:
    """Canonicalize an Instagram Reel URL without accepting Facebook links."""
    candidate = _trim_duplicate_instagram_url(value)
    if not candidate.startswith(("http://", "https://")):
        candidate = f"https://{candidate}"
    host = (urlparse(candidate).hostname or "").lower()
    if _is_instagram_host(host):
        await _assert_public_host(candidate)
        return _canonical_instagram_reel_url(candidate)
    raise ValueError("Please provide a direct Instagram Reel link.")


def _trim_duplicate_instagram_url(value: str) -> str:
    """Recover from a common paste error: two Instagram URLs concatenated."""
    candidate = value.strip()
    matches = list(_INSTAGRAM_URL_RE.finditer(candidate))
    if len(matches) > 1:
        return candidate[:matches[1].start()]
    return candidate


def _canonical_instagram_reel_url(value: str) -> str:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if not _is_instagram_host(host):
        raise ValueError("Please provide a direct Instagram Reel link.")
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2 or parts[0].lower() not in {"reel", "reels"} or not parts[1]:
        raise ValueError("Please provide a direct Instagram Reel link.")
    return f"https://www.instagram.com/reel/{parts[1]}/"


async def _fetch_instagram_reel(url: str, *, include_transcript: bool) -> dict[str, Any]:
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        raise ValueError("Instagram Reel import is not configured. Set APIFY_TOKEN on the backend.")

    actor_id = INSTAGRAM_REELS_ACTOR_ID.replace("/", "~")
    endpoint = f"https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items"
    payload = {
        # The official actor calls this field `username`, even for direct Reel URLs.
        "username": [url],
        "resultsLimit": 1,
        "includeTranscript": include_transcript,
    }
    try:
        timeout_s = INSTAGRAM_REELS_TRANSCRIPT_TIMEOUT_S if include_transcript else INSTAGRAM_REELS_METADATA_TIMEOUT_S
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(endpoint, params={"token": token}, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("[InstagramReels] Apify rejected %s: %s", url, exc.response.text[:500])
        raise ValueError("Instagram could not read this Reel. It may be private, deleted, or unavailable in the scraper region.") from exc
    except httpx.HTTPError as exc:
        logger.warning("[InstagramReels] Apify request failed for %s: %s", url, exc)
        raise ValueError("Instagram Reel import timed out while reading the public video.") from exc

    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        raise ValueError("Instagram did not return readable data for this Reel.")
    return data[0]


def _source_text_from_item(item: dict[str, Any], url: str) -> tuple[str, str]:
    caption = _string(item.get("caption")) or _string(item.get("text"))
    hashtags = _hashtags_text(item.get("hashtags"))
    owner = _string(item.get("ownerUsername")) or _string(item.get("owner_username")) or _string(item.get("username"))
    location = _value_text(item.get("location"))
    transcript = _string(item.get("transcript"))

    title = caption or (f"Instagram Reel by @{owner}" if owner else "Instagram Reel")
    title = re.sub(r"\s+", " ", title).strip()[:160]
    parts = [f"Instagram Reel URL: {url}"]
    if caption:
        parts.append(f"Reel caption: {caption}")
    if hashtags:
        parts.append(f"Hashtags: {hashtags}")
    if owner:
        parts.append(f"Creator: @{owner.lstrip('@')}")
    if location:
        parts.append(f"Instagram location: {location}")
    if transcript:
        parts.append(f"Reel transcript: {transcript}")

    return title, "\n\n".join(parts) if any([caption, hashtags, location, transcript]) else ""


def _needs_transcript(extracted: dict[str, Any]) -> bool:
    locations = extracted.get("locations") if isinstance(extracted, dict) else None
    if not isinstance(locations, list) or not locations:
        return True
    for location in locations:
        if not isinstance(location, dict):
            continue
        try:
            if int(location.get("hierarchy_level", 2)) <= 1:
                return False
        except (TypeError, ValueError):
            continue
    return True


def _build_geocode_queries(locations: list[dict], inferred_region: str | None) -> list[dict]:
    queries = []
    for location in locations:
        name = (location.get("name") or "").strip()
        context = (location.get("context") or inferred_region or "").strip()
        query = f"{name}, {context}" if context and context.lower() not in name.lower() else name
        queries.append({"query": query, "name": name})
    return queries


def _matches_inferred_region(geocoded: dict, inferred_region: str | None) -> bool:
    if not inferred_region:
        return True
    address = re.sub(r"[^a-z0-9]+", " ", (geocoded.get("full_address") or "").lower())
    if not address.strip():
        return False
    ignored = {"us", "usa", "united states", "uk", "united kingdom", "france", "italy", "japan", "china"}
    candidates: set[str] = set()
    for part in inferred_region.split(","):
        candidate = re.sub(r"[^a-z0-9]+", " ", part.lower()).strip()
        if len(candidate) <= 2 or candidate in ignored:
            continue
        candidates.add(candidate)
        # Geocoders commonly omit administrative suffixes from their formatted
        # address (for example, "New York City" becomes "New York, NY").
        # Keep the geographic name while still rejecting another city.
        shortened = re.sub(r"\b(city|county|municipality|metropolitan area)\b$", "", candidate).strip()
        if len(shortened) > 2 and shortened not in ignored:
            candidates.add(shortened)
    return any(re.search(rf"\b{re.escape(candidate)}\b", address) for candidate in candidates)


def _is_instagram_host(host: str) -> bool:
    return host in {"instagram.com", "instagr.am"} or host.endswith(".instagram.com")


def _string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _value_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return " ".join(text for item in value if (text := _value_text(item))).strip()
    if isinstance(value, dict):
        return " ".join(text for item in value.values() if (text := _value_text(item))).strip()
    return ""


def _hashtags_text(value: Any) -> str:
    if isinstance(value, str):
        return " ".join(f"#{tag.lstrip('#')}" for tag in value.split() if tag.strip())
    if not isinstance(value, list):
        return ""
    names = []
    for tag in value:
        name = _string(tag.get("name")) if isinstance(tag, dict) else _string(tag)
        if name:
            names.append(f"#{name.lstrip('#')}")
    return " ".join(names)
