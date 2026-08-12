"""TikTok video place extraction backed by a maintained Apify actor.

TikTok does not provide a stable public transcript API. The first pass uses
caption, hashtags, creator context, and TikTok location metadata. Only when
that pass is not specific enough do we pay for subtitle download/transcription.
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

logger = logging.getLogger("atlas.tiktok_places")

TIKTOK_ACTOR_ID = os.environ.get("TIKTOK_APIFY_ACTOR", "clockworks/tiktok-scraper")
TIKTOK_METADATA_TIMEOUT_S = float(os.environ.get("TIKTOK_METADATA_TIMEOUT_S", "45"))
TIKTOK_TRANSCRIPTION_TIMEOUT_S = float(os.environ.get("TIKTOK_TRANSCRIPTION_TIMEOUT_S", "90"))
_TIKTOK_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"


def _normalize_tiktok_url(value: str) -> str:
    url = value.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    host = (urlparse(url).hostname or "").lower()
    if host != "tiktok.com" and not host.endswith(".tiktok.com"):
        raise ValueError("Please provide a TikTok video link.")
    return url


async def parse_tiktok_url(url: str, request_id: str | None = None) -> dict:
    """Parse one public TikTok video into Atlas's standard place response."""
    normalized_url = _normalize_tiktok_url(url)
    await _assert_public_host(normalized_url)
    normalized_url = await _expand_tiktok_share_url(normalized_url)
    await _assert_public_host(normalized_url)

    from backend.services import progress

    progress.stream_note(request_id, "tiktok:fetch", {"detail": "Collecting the public video caption and metadata."})
    item = await _fetch_tiktok_video(normalized_url, download_subtitles=False)
    title, source_text = _source_text_from_item(item, normalized_url)
    progress.mark(request_id, "source_fetched", "Source prepared.", {"title": title, "source_type": "tiktok_links"})
    progress.stream_note(request_id, "tiktok:caption", {"detail": "Video caption and hashtags collected."})

    extracted: dict[str, Any] = {}
    if source_text:
        english_text = await translate_to_english(source_text, request_id=request_id)
        progress.stream_note(request_id, "tiktok:deepseek", {"detail": "Extracting places from TikTok context."})
        extracted = await ExtractionPipeline.extract(english_text, source_type="tiktok_links", request_id=request_id)

    # Captions often say only "things to do in Paris". Pay for transcription
    # only when the first extraction has no specific POI/neighborhood to map.
    if _needs_transcription(extracted):
        progress.stream_note(request_id, "tiktok:transcribe", {"detail": "The caption was not specific enough; requesting subtitles or speech-to-text."})
        transcribed_item = await _fetch_tiktok_video(normalized_url, download_subtitles=True)
        subtitle_text = await _download_subtitle_text(transcribed_item)
        _, enriched_text = _source_text_from_item(transcribed_item, normalized_url, subtitle_text=subtitle_text)
        if enriched_text and enriched_text != source_text:
            progress.stream_note(request_id, "tiktok:transcript", {"detail": "Transcript ready; checking spoken place references."})
            english_text = await translate_to_english(enriched_text, request_id=request_id)
            progress.stream_note(request_id, "tiktok:deepseek", {"detail": "Extracting places from caption and transcript."})
            extracted = await ExtractionPipeline.extract(english_text, source_type="tiktok_links", request_id=request_id)

    if not source_text and not extracted:
        raise ValueError("This TikTok video has no public caption, subtitle, or transcript text to analyze.")

    location_names = extracted.get("locations", [])
    progress.stream_identified_places(request_id, location_names)
    progress.stream_note(request_id, "tiktok:geocode", {"detail": f"Geocoding {len(location_names)} places."})

    inferred_region = extracted.get("inferred_region")
    if inferred_region:
        progress.stream_note(request_id, "analysis:region", {
            "region": inferred_region,
            "tagline": extracted.get("region_tagline"),
        })

    geocoded = await batch_geocode(
        _build_geocode_queries(location_names, inferred_region),
        city_name=inferred_region,
    )
    locations: list[dict[str, Any]] = []
    removed_noise = list(extracted.get("removed_noise", []))
    for location, geo in zip(location_names, geocoded):
        if not geo:
            continue
        if not _matches_inferred_region(geo, inferred_region):
            removed_noise.append({
                "name": location.get("name", ""),
                "reason": f"Geocoding result is outside the video's inferred region: {inferred_region}",
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
            "source": "tiktok_links",
        })

    return {
        "title": title,
        "locations": locations,
        "route": {"ordered_locations": [], "total_distance_km": 0.0, "segments": []},
        "removed_noise": removed_noise,
        "removed_hierarchy": extracted.get("removed_hierarchy", []),
        "inferred_region": inferred_region,
        "source_type": "tiktok_links",
    }


async def _fetch_tiktok_video(url: str, *, download_subtitles: bool) -> dict[str, Any]:
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        raise ValueError("TikTok import is not configured. Set APIFY_TOKEN on the backend.")

    endpoint = f"https://api.apify.com/v2/acts/{TIKTOK_ACTOR_ID}/run-sync-get-dataset-items"
    payload = {
        "postURLs": [url],
        "scrapeRelatedVideos": False,
        "shouldDownloadAvatars": False,
        "shouldDownloadCovers": False,
        "shouldDownloadMusicCovers": False,
        "shouldDownloadSlideshowImages": False,
        "shouldDownloadVideos": False,
        "downloadSubtitlesOptions": (
            "DOWNLOAD_AND_TRANSCRIBE_VIDEOS_WITHOUT_SUBTITLES"
            if download_subtitles
            else "NEVER_DOWNLOAD_SUBTITLES"
        ),
    }
    try:
        timeout_s = TIKTOK_TRANSCRIPTION_TIMEOUT_S if download_subtitles else TIKTOK_METADATA_TIMEOUT_S
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(endpoint, params={"token": token}, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("[TikTokPlaces] Apify rejected %s: %s", url, exc.response.text[:500])
        raise ValueError("TikTok could not read this video. It may be private, deleted, or unavailable in the scraper region.") from exc
    except httpx.HTTPError as exc:
        logger.warning("[TikTokPlaces] Apify request failed for %s: %s", url, exc)
        raise ValueError("TikTok import timed out while reading the public video.") from exc

    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        raise ValueError("TikTok did not return readable data for this video.")
    return data[0]


def _needs_transcription(extracted: dict[str, Any]) -> bool:
    """Return True when metadata has no concrete POI-level location."""
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


async def _download_subtitle_text(item: dict[str, Any]) -> str:
    """Download VTT/SRT links returned by the actor and normalize their text."""
    links = item.get("subtitleLinks") or item.get("subtitle_links") or []
    if not isinstance(links, list):
        return _value_text(item.get("subtitles"))
    texts: list[str] = []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        for link in links:
            download_link = link.get("downloadLink") if isinstance(link, dict) else link
            if not isinstance(download_link, str) or not download_link.strip():
                continue
            try:
                response = await client.get(download_link)
                response.raise_for_status()
                texts.append(_clean_caption_file(response.text))
            except httpx.HTTPError as exc:
                logger.info("[TikTokPlaces] Subtitle download failed: %s", exc)
    return "\n".join(text for text in texts if text).strip()


def _clean_caption_file(value: str) -> str:
    lines: list[str] = []
    for line in value.replace("\\r", "").splitlines():
        line = re.sub(r"<[^>]+>", " ", line).strip()
        if not line or line.upper() == "WEBVTT" or "-->" in line or re.fullmatch(r"\d+", line):
            continue
        if line not in lines:
            lines.append(line)
    return " ".join(lines)


async def _expand_tiktok_share_url(url: str) -> str:
    """Resolve the short links produced by TikTok's mobile Share action."""
    host = (urlparse(url).hostname or "").lower()
    if host not in {"vm.tiktok.com", "vt.tiktok.com"}:
        return url
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=3.0),
            headers={"User-Agent": _TIKTOK_USER_AGENT},
            follow_redirects=True,
        ) as client:
            async with client.stream("GET", url) as response:
                resolved = str(response.url)
        resolved_host = (urlparse(resolved).hostname or "").lower()
        if resolved_host == "tiktok.com" or resolved_host.endswith(".tiktok.com"):
            return resolved
    except httpx.HTTPError as exc:
        logger.info("[TikTokPlaces] Could not expand share link %s: %s", url, exc)
    return url


def _source_text_from_item(item: dict[str, Any], url: str, subtitle_text: str = "") -> tuple[str, str]:
    caption = _string(item.get("text"))
    author = item.get("authorMeta") if isinstance(item.get("authorMeta"), dict) else {}
    author_name = _string(author.get("name")) or _string(item.get("authorMeta.name"))
    author_display_name = _string(author.get("nickName")) or _string(item.get("authorMeta.nickName"))
    hashtags = _hashtags_text(item.get("hashtags"))
    subtitle_text = subtitle_text or _value_text(item.get("subtitles"))
    location = _value_text(item.get("locationCreated"))

    title = caption or (f"TikTok video by @{author_name}" if author_name else "TikTok video")
    title = re.sub(r"\s+", " ", title).strip()[:160]
    parts = [f"TikTok video URL: {url}"]
    if caption:
        parts.append(f"Video caption: {caption}")
    if hashtags:
        parts.append(f"Hashtags: {hashtags}")
    if author_name or author_display_name:
        creator = " ".join(part for part in [f"@{author_name}" if author_name else "", author_display_name] if part)
        parts.append(f"Creator: {creator}")
    if location:
        parts.append(f"TikTok location: {location}")
    if subtitle_text:
        parts.append(f"Video subtitles: {subtitle_text}")

    has_meaningful_content = bool(caption or hashtags or subtitle_text or location)
    return title, "\n\n".join(parts) if has_meaningful_content else ""


def _string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _value_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return " ".join(_value_text(item) for item in value if _value_text(item)).strip()
    if isinstance(value, dict):
        return " ".join(_value_text(item) for item in value.values() if _value_text(item)).strip()
    return ""


def _hashtags_text(value: Any) -> str:
    if not isinstance(value, list):
        return ""
    names = []
    for tag in value:
        name = _string(tag.get("name")) if isinstance(tag, dict) else _string(tag)
        if name:
            names.append(f"#{name.lstrip('#')}")
    return " ".join(names)


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
    candidates = [
        re.sub(r"[^a-z0-9]+", " ", part.lower()).strip()
        for part in inferred_region.split(",")
    ]
    candidates = [candidate for candidate in candidates if len(candidate) > 2 and candidate not in ignored]
    return any(re.search(rf"\b{re.escape(candidate)}\b", address) for candidate in candidates)
