"""Facebook video place extraction backed by a direct-link Apify actor.

The actor accepts one public Facebook video or Reel URL and returns its public
metadata. Atlas intentionally does not download, caption, or transcribe media
in this flow; place extraction uses only title, description, and uploader data.
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

FACEBOOK_VIDEO_ACTOR_ID = os.environ.get(
    "FACEBOOK_VIDEO_APIFY_ACTOR",
    "scrapepilot/facebook-reels-downloader-video-metadata-extractor",
)
FACEBOOK_VIDEO_METADATA_TIMEOUT_S = float(os.environ.get("FACEBOOK_VIDEO_METADATA_TIMEOUT_S", "60"))


async def parse_facebook_reel_url(url: str, request_id: str | None = None) -> dict:
    """Parse a public Facebook video, Reel, watch, or share URL into Atlas's place response."""
    facebook_url = await _normalize_facebook_url(url)

    from backend.services import progress

    progress.stream_note(request_id, "facebook:fetch", {"detail": "Collecting public video metadata."})
    item = await _fetch_facebook_video(facebook_url)
    title, source_text = _source_text_from_item(item, facebook_url)
    source_thumbnail = _source_thumbnail_from_item(item)
    progress.mark(request_id, "source_fetched", "Source prepared.", {
        "title": title,
        "thumbnail_url": source_thumbnail,
        "source_type": "facebook_reels",
    })
    progress.stream_note(request_id, "facebook:caption", {"detail": "Public video metadata collected."})

    if not source_text:
        raise ValueError("This Facebook video has no public title, description, or creator information to analyze.")

    english_text = await translate_to_english(source_text, request_id=request_id)
    progress.stream_note(request_id, "facebook:deepseek", {"detail": "Extracting places from the video context."})
    extracted = await ExtractionPipeline.extract(english_text, source_type="facebook_reels", request_id=request_id)

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
        "source_thumbnail": source_thumbnail or None,
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


async def _fetch_facebook_video(url: str) -> dict[str, Any]:
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        raise ValueError("Facebook video import is not configured. Set APIFY_TOKEN on the backend.")

    actor_id = FACEBOOK_VIDEO_ACTOR_ID.replace("/", "~")
    endpoint = f"https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items"
    payload = _facebook_video_actor_input(url)
    try:
        async with httpx.AsyncClient(timeout=FACEBOOK_VIDEO_METADATA_TIMEOUT_S) as client:
            response = await client.post(endpoint, params={"token": token}, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("[FacebookReels] Apify rejected %s: %s", url, exc.response.text[:500])
        raise ValueError("Facebook could not read this video. It may be private, deleted, or unavailable in the scraper region.") from exc
    except httpx.HTTPError as exc:
        logger.warning("[FacebookReels] Apify request failed for %s: %s", url, exc)
        raise ValueError("Facebook video import timed out while reading the public video.") from exc

    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        raise ValueError("Facebook did not return readable data for this video.")
    return data[0]


def _facebook_video_actor_input(url: str) -> dict[str, str]:
    # The Actor's live schema currently accepts its `urls` field as a single
    # string, despite its public README also showing an array example.
    return {"urls": url}


def _source_text_from_item(item: dict[str, Any], url: str) -> tuple[str, str]:
    video_title = _string(item.get("title"))
    description = _string(item.get("description")) or _string(item.get("caption")) or _string(item.get("text"))
    uploader = _string(item.get("uploader")) or _string(item.get("author")) or _string(item.get("owner"))
    video_url = _string(item.get("url")) or url
    title = video_title or description or (f"Facebook video by {uploader}" if uploader else "Facebook video")
    title = re.sub(r"\s+", " ", title).strip()[:160]
    parts = [f"Facebook video URL: {video_url}"]
    if video_title:
        parts.append(f"Video title: {video_title}")
    if description:
        parts.append(f"Video description: {description}")
    if uploader:
        parts.append(f"Uploader: {uploader}")
    return title, "\n\n".join(parts) if any([video_title, description, uploader]) else ""


def _source_thumbnail_from_item(item: dict[str, Any]) -> str:
    return (
        _string(item.get("thumbnail"))
        or _string(item.get("thumbnail_url"))
        or _string(item.get("thumbnailUrl"))
    )


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
