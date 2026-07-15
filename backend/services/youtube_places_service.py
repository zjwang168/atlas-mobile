"""YouTube places pipeline.

Flow:
1. Extract transcript via `youtube-transcript-api`.
2. Extract chapters from the YouTube page description / metadata when available.
3. Feed the combined English text into the DeepSeek-based extraction pipeline.
4. Geocode the extracted locations.
5. Return a ParseResponse-compatible payload for Save Places.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

import httpx

from backend.services.extraction_pipeline import ExtractionPipeline
from backend.services.geocoder import batch_geocode
from backend.services.translation import translate_to_english

logger = logging.getLogger("atlas.youtube_places")

YOUTUBE_TIMEOUT_S = float(os.environ.get("YOUTUBE_FETCH_TIMEOUT_S", "20"))


@dataclass
class YouTubeSource:
    title: str
    url: str
    transcript_text: str
    chapter_text: str
    combined_text: str


async def parse_youtube_url(url: str, request_id: str | None = None) -> dict:
    """Parse a YouTube URL into geocoded places."""
    source = await _build_source_text(url)
    if not source.combined_text.strip():
        return _build_response(
            title=source.title or "YouTube video",
            locations=[],
            route={"ordered_locations": [], "total_distance_km": 0.0, "segments": []},
            removed_noise=[],
            removed_hierarchy=[],
            inferred_region=None,
            source_type="youtube_links",
        )

    from backend.services import progress
    progress.stream_note(request_id, "youtube:transcript", {"detail": "Transcript and chapters collected."})

    english_text = await translate_to_english(source.combined_text, request_id=request_id)
    progress.stream_note(request_id, "youtube:deepseek", {"detail": "Extracting places from YouTube content."})

    extracted = await ExtractionPipeline.extract(english_text, source_type="youtube_links", request_id=request_id)
    location_names = extracted.get("locations", [])
    progress.stream_note(request_id, "youtube:geocode", {"detail": f"Geocoding {len(location_names)} places."})

    geocoded = await batch_geocode(
        location_names,
        city_name=extracted.get("inferred_region"),
    )

    locations = []
    for loc, geo in zip(location_names, geocoded):
        if not geo:
            continue
        locations.append(
            {
                "name": loc.get("name", geo.get("name", "")),
                "latitude": geo.get("latitude", 0),
                "longitude": geo.get("longitude", 0),
                "full_address": geo.get("full_address", ""),
                "sentiment": loc.get("sentiment"),
                "description": loc.get("description"),
                "category": loc.get("category"),
                "is_exact": True,
                "confidence": loc.get("confidence"),
                "source": "youtube_links",
            }
        )

    return _build_response(
        title=source.title or "YouTube video",
        locations=locations,
        route={"ordered_locations": [], "total_distance_km": 0.0, "segments": []},
        removed_noise=extracted.get("removed_noise", []),
        removed_hierarchy=extracted.get("removed_hierarchy", []),
        inferred_region=extracted.get("inferred_region"),
        source_type="youtube_links",
    )


async def _build_source_text(url: str) -> YouTubeSource:
    video_id = _extract_video_id(url)
    if not video_id:
        return YouTubeSource(title="YouTube video", url=url, transcript_text="", chapter_text="", combined_text="")

    html = await _fetch_youtube_html(url)
    title = _extract_title(html) or "YouTube video"
    chapter_text = _extract_chapters(html)
    transcript_text = await _fetch_transcript_text(video_id)

    combined_parts = [
        f"Video title: {title}",
        f"Video URL: {url}",
    ]
    if chapter_text:
        combined_parts.append("Chapters:\n" + chapter_text)
    if transcript_text:
        combined_parts.append("Transcript:\n" + transcript_text)

    combined_text = "\n\n".join(part for part in combined_parts if part.strip())
    return YouTubeSource(
        title=title,
        url=url,
        transcript_text=transcript_text,
        chapter_text=chapter_text,
        combined_text=combined_text,
    )


async def _fetch_transcript_text(video_id: str) -> str:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        def _load() -> str:
            api = YouTubeTranscriptApi()
            transcript = api.fetch(video_id)
            return "\n".join(
                f"[{int(item.start // 60):02d}:{int(item.start % 60):02d}] {item.text}"
                for item in transcript
            )

        return await asyncio.to_thread(_load)
    except Exception as exc:
        logger.warning("[YouTubePlaces] Failed to fetch transcript for %s: %s", video_id, exc)
        return ""


async def _fetch_youtube_html(url: str) -> str:
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            )
        }
        async with httpx.AsyncClient(timeout=YOUTUBE_TIMEOUT_S, headers=headers, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.text
    except Exception as exc:
        logger.warning("[YouTubePlaces] Failed to fetch YouTube HTML: %s", exc)
        return ""


def _extract_title(html: str) -> str:
    if not html:
        return ""
    for pattern in (
        r'<meta property="og:title" content="([^"]+)"',
        r'"title":"([^"]+)"',
    ):
        match = re.search(pattern, html)
        if match:
            return _html_unescape(match.group(1))
    return ""


def _extract_chapters(html: str) -> str:
    if not html:
        return ""

    patterns = [
        r'"chapters":\s*\[(.*?)\]\s*,\s*"viewCount',
        r'"playerOverlays":.*?"chapter":',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.DOTALL)
        if match:
            chunk = match.group(1) if match.groups() else match.group(0)
            return _clean_chapter_chunk(chunk)

    desc = _extract_description(html)
    if not desc:
        return ""

    chapter_lines = []
    for line in desc.splitlines():
        if re.match(r"^\s*\d{1,2}:\d{2}(?::\d{2})?\s+", line):
            chapter_lines.append(line.strip())
    return "\n".join(chapter_lines)


def _extract_description(html: str) -> str:
    if not html:
        return ""
    match = re.search(r'"shortDescription":"(.*?)"', html, flags=re.DOTALL)
    if not match:
        return ""
    raw = match.group(1)
    return _html_unescape(raw.replace(r"\n", "\n").replace(r"\/", "/"))


def _clean_chapter_chunk(chunk: str) -> str:
    text = _html_unescape(chunk)
    text = text.replace(r"\n", "\n")
    text = re.sub(r'\{"title":"([^"]+)","timeRangeStartMillis":(\d+).*?\}', r"\1", text)
    return text


def _extract_video_id(url: str) -> str:
    patterns = [
        r"(?:v=)([A-Za-z0-9_-]{11})",
        r"youtu\.be/([A-Za-z0-9_-]{11})",
        r"/shorts/([A-Za-z0-9_-]{11})",
        r"/live/([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return ""


def _html_unescape(value: str) -> str:
    import html

    return html.unescape(value or "")


def _build_response(
    title: str,
    locations: list[dict],
    route: dict,
    removed_noise: list,
    removed_hierarchy: list,
    inferred_region: Optional[str],
    source_type: str,
) -> dict:
    return {
        "title": title,
        "locations": locations,
        "route": route,
        "removed_noise": removed_noise,
        "removed_hierarchy": removed_hierarchy,
        "inferred_region": inferred_region,
        "source_type": source_type,
    }
