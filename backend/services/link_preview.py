"""Fast, best-effort metadata previews for pasted links."""

from __future__ import annotations

import html
import re
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from bs4 import BeautifulSoup

from backend.services.universal_web_content import _assert_public_host

_TIMEOUT = httpx.Timeout(5.0, connect=2.0)
_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"


def _youtube_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host in {"youtu.be", "www.youtu.be"}:
        return parsed.path.strip("/").split("/")[0] or None
    if "youtube.com" not in host:
        return None
    query_id = parse_qs(parsed.query).get("v", [None])[0]
    if query_id:
        return query_id
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 2 and parts[0] in {"shorts", "live", "embed"}:
        return parts[1]
    return None


def _is_reddit(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "reddit.com" or host.endswith(".reddit.com") or host == "redd.it"


def _is_tiktok(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "tiktok.com" or host.endswith(".tiktok.com")


def _is_instagram_reel(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in {"instagram.com", "instagr.am"} and not host.endswith(".instagram.com"):
        return False
    parts = [part.lower() for part in parsed.path.split("/") if part]
    return len(parts) >= 2 and parts[0] in {"reel", "reels"}


def _is_facebook(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "facebook.com" or host.endswith(".facebook.com") or host == "fb.watch"


def _meta(soup: BeautifulSoup, key: str) -> str:
    tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
    return html.unescape(str(tag.get("content", "")).strip()) if tag else ""


async def build_link_preview(url: str) -> dict:
    normalized = url.strip()
    if normalized.lower().startswith("www."):
        normalized = f"https://{normalized}"
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return {"kind": "unknown", "title": "", "image_url": None, "hostname": ""}
    await _assert_public_host(normalized)

    video_id = _youtube_id(normalized)
    if video_id:
        title = ""
        try:
            endpoint = "https://www.youtube.com/oembed?" + urlencode({"url": normalized, "format": "json"})
            async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _USER_AGENT}, follow_redirects=True) as client:
                response = await client.get(endpoint)
                if response.is_success:
                    title = str(response.json().get("title", "")).strip()
        except Exception:
            pass
        return {
            "kind": "youtube",
            "title": title or "YouTube video",
            "image_url": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "hostname": "youtube.com",
        }

    if _is_reddit(normalized):
        title = ""
        try:
            endpoint = "https://www.reddit.com/oembed?" + urlencode({"url": normalized, "format": "json"})
            async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _USER_AGENT}, follow_redirects=True) as client:
                response = await client.get(endpoint)
                if response.is_success:
                    title = str(response.json().get("title", "")).strip()
        except Exception:
            pass
        return {"kind": "reddit", "title": title or "Reddit post", "image_url": None, "hostname": "reddit.com"}

    if _is_tiktok(normalized):
        title = ""
        image_url = None
        try:
            endpoint = "https://www.tiktok.com/oembed?" + urlencode({"url": normalized})
            async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _USER_AGENT}, follow_redirects=True) as client:
                response = await client.get(endpoint)
                if response.is_success:
                    payload = response.json()
                    title = str(payload.get("title", "")).strip()
                    image_url = str(payload.get("thumbnail_url", "")).strip() or None
        except Exception:
            pass
        return {"kind": "tiktok", "title": title or "TikTok video", "image_url": image_url, "hostname": "tiktok.com"}

    if _is_instagram_reel(normalized):
        title = ""
        image_url = None
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _USER_AGENT}, follow_redirects=True) as client:
                response = await client.get(normalized)
                if response.is_success:
                    soup = BeautifulSoup(response.text, "lxml")
                    title = _meta(soup, "og:title") or _meta(soup, "twitter:title")
                    image_url = _meta(soup, "og:image") or _meta(soup, "twitter:image") or None
        except Exception:
            pass
        return {"kind": "instagram", "title": title or "Instagram Reel", "image_url": image_url, "hostname": "instagram.com"}

    if _is_facebook(normalized):
        return {"kind": "facebook", "title": "Facebook Reel", "image_url": None, "hostname": "facebook.com"}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _USER_AGENT}, follow_redirects=True) as client:
            response = await client.get(normalized)
            response.raise_for_status()
        soup = BeautifulSoup(response.text, "lxml")
        title = _meta(soup, "og:title") or _meta(soup, "twitter:title")
        if not title and soup.title:
            title = soup.title.get_text(" ", strip=True)
        image_url = _meta(soup, "og:image") or _meta(soup, "twitter:image") or None
        return {
            "kind": "web",
            "title": re.sub(r"\s+", " ", title).strip() or parsed.hostname,
            "image_url": image_url,
            "hostname": parsed.hostname,
        }
    except Exception:
        return {"kind": "web", "title": parsed.hostname or "Web page", "image_url": None, "hostname": parsed.hostname or ""}
