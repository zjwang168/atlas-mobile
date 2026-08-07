"""Facebook Reel place extraction backed by Apify's official Reels actor.

The actor supplies Reel text and, when Facebook exposes it, caption-file URLs.
It has no speech-to-text input flag, so the second pass downloads only public
captions and never attempts to download or transcribe video/audio itself.
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

logger = logging.getLogger("atlas.facebook_reels")

FACEBOOK_REELS_ACTOR_ID = os.environ.get("FACEBOOK_REELS_APIFY_ACTOR", "apify/facebook-reels-scraper")
FACEBOOK_REELS_METADATA_TIMEOUT_S = float(os.environ.get("FACEBOOK_REELS_METADATA_TIMEOUT_S", "45"))
FACEBOOK_REELS_CAPTIONS_TIMEOUT_S = float(os.environ.get("FACEBOOK_REELS_CAPTIONS_TIMEOUT_S", "45"))


async def parse_facebook_reel_url(url: str, request_id: str | None = None) -> dict:
    """Parse a public Facebook Reel or share URL into Atlas's place response."""
    facebook_url = await _normalize_facebook_url(url)

    from backend.services import progress

    progress.stream_note(request_id, "facebook:fetch", {"detail": "Collecting the public Reel text and metadata."})
    item = await _fetch_facebook_reel(facebook_url)
    title, source_text = _source_text_from_item(item, facebook_url)
    progress.mark(request_id, "source_fetched", "Source prepared.", {"title": title, "source_type": "facebook_reels"})
    progress.stream_note(request_id, "facebook:caption", {"detail": "Reel text and public metadata collected."})

    extracted: dict[str, Any] = {}
    if source_text:
        english_text = await translate_to_english(source_text, request_id=request_id)
        progress.stream_note(request_id, "facebook:deepseek", {"detail": "Extracting places from the Reel context."})
        extracted = await ExtractionPipeline.extract(english_text, source_type="facebook_reels", request_id=request_id)

    # This actor exposes Facebook's existing caption files but has no
    # speech-to-text option. Download those only when metadata is insufficient.
    if _needs_captions(extracted):
        caption_text = await _download_caption_text(item)
        if caption_text:
            progress.stream_note(request_id, "facebook:transcript", {"detail": "Public captions ready; checking spoken place references."})
            _, enriched_text = _source_text_from_item(item, facebook_url, caption_text=caption_text)
            if enriched_text != source_text:
                english_text = await translate_to_english(enriched_text, request_id=request_id)
                progress.stream_note(request_id, "facebook:deepseek", {"detail": "Extracting places from the Reel text and captions."})
                extracted = await ExtractionPipeline.extract(english_text, source_type="facebook_reels", request_id=request_id)
        else:
            progress.stream_note(request_id, "facebook:captions_unavailable", {"detail": "No public caption file was available for this Reel."})

    if not source_text and not extracted:
        raise ValueError("This Facebook Reel has no public text or captions to analyze.")

    location_names = extracted.get("locations", [])
    progress.stream_identified_places(request_id, location_names)
    progress.stream_note(request_id, "facebook:geocode", {"detail": f"Geocoding {len(location_names)} places."})
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
            "source": "facebook_reels",
        })

    return {
        "title": title,
        "locations": locations,
        "route": {"ordered_locations": [], "total_distance_km": 0.0, "segments": []},
        "removed_noise": removed_noise,
        "removed_hierarchy": extracted.get("removed_hierarchy", []),
        "inferred_region": inferred_region,
        "source_type": "facebook_reels",
    }


async def _normalize_facebook_url(value: str) -> str:
    url = value.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    host = (urlparse(url).hostname or "").lower()
    if not _is_facebook_host(host):
        raise ValueError("Please provide a Facebook Reel or Facebook share link.")
    await _assert_public_host(url)
    return url


async def _fetch_facebook_reel(url: str) -> dict[str, Any]:
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        raise ValueError("Facebook Reel import is not configured. Set APIFY_TOKEN on the backend.")

    actor_id = FACEBOOK_REELS_ACTOR_ID.replace("/", "~")
    endpoint = f"https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items"
    payload = {
        "startUrls": [{"url": url}],
        "resultsLimit": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=FACEBOOK_REELS_METADATA_TIMEOUT_S) as client:
            response = await client.post(endpoint, params={"token": token}, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("[FacebookReels] Apify rejected %s: %s", url, exc.response.text[:500])
        raise ValueError("Facebook could not read this Reel. It may be private, deleted, or unavailable in the scraper region.") from exc
    except httpx.HTTPError as exc:
        logger.warning("[FacebookReels] Apify request failed for %s: %s", url, exc)
        raise ValueError("Facebook Reel import timed out while reading the public video.") from exc

    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        raise ValueError("Facebook did not return readable data for this Reel.")
    return data[0]


def _source_text_from_item(item: dict[str, Any], url: str, caption_text: str = "") -> tuple[str, str]:
    text = _string(item.get("text")) or _value_text(item.get("message"))
    creator_url = _string(item.get("facebookUrl")) or _string(item.get("inputUrl"))
    reel_url = _string(item.get("shareable_url")) or _string(item.get("topLevelReelUrl")) or url
    title = text or "Facebook Reel"
    title = re.sub(r"\s+", " ", title).strip()[:160]
    parts = [f"Facebook Reel URL: {reel_url}"]
    if text:
        parts.append(f"Reel text: {text}")
    if creator_url:
        parts.append(f"Creator page: {creator_url}")
    if caption_text:
        parts.append(f"Reel captions: {caption_text}")
    return title, "\n\n".join(parts) if text or caption_text else ""


async def _download_caption_text(item: dict[str, Any]) -> str:
    links = _caption_urls(item)
    if not links:
        return ""
    texts: list[str] = []
    async with httpx.AsyncClient(timeout=FACEBOOK_REELS_CAPTIONS_TIMEOUT_S, follow_redirects=True) as client:
        # Facebook commonly returns the same caption in several locales; two
        # distinct files are enough for a fast fallback without delaying import.
        for link in links[:2]:
            try:
                await _assert_public_host(link)
                response = await client.get(link)
                response.raise_for_status()
                cleaned = _clean_caption_file(response.text)
                if cleaned:
                    texts.append(cleaned)
            except (ValueError, httpx.HTTPError) as exc:
                logger.info("[FacebookReels] Caption download failed: %s", exc)
    return " ".join(dict.fromkeys(texts))


def _caption_urls(item: dict[str, Any]) -> list[str]:
    playback = item.get("playback_video") if isinstance(item.get("playback_video"), dict) else {}
    candidates: list[Any] = [
        item.get("captions_url"),
        item.get("caption_file_url"),
        playback.get("captions_url"),
        playback.get("caption_file_url"),
    ]
    locales = playback.get("video_available_captions_locales") or item.get("video_available_captions_locales") or []
    if isinstance(locales, list):
        candidates.extend(entry.get("captions_url") for entry in locales if isinstance(entry, dict))
    return list(dict.fromkeys(value.strip() for value in candidates if isinstance(value, str) and value.strip()))


def _clean_caption_file(value: str) -> str:
    lines: list[str] = []
    for line in value.replace("\r", "").splitlines():
        line = re.sub(r"<[^>]+>", " ", line).strip()
        if not line or line.upper() == "WEBVTT" or "-->" in line or re.fullmatch(r"\d+", line):
            continue
        if line not in lines:
            lines.append(line)
    return " ".join(lines)


def _needs_captions(extracted: dict[str, Any]) -> bool:
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
    candidates = [re.sub(r"[^a-z0-9]+", " ", part.lower()).strip() for part in inferred_region.split(",")]
    candidates = [candidate for candidate in candidates if len(candidate) > 2 and candidate not in ignored]
    return any(re.search(rf"\b{re.escape(candidate)}\b", address) for candidate in candidates)


def _is_facebook_host(host: str) -> bool:
    return host == "facebook.com" or host.endswith(".facebook.com") or host == "fb.watch"


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
