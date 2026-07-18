"""Wikipedia PageImages source for place thumbnails."""

import os

from curl_cffi.requests import AsyncSession

PHOTO_TIMEOUT_S = 2.5
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_USER_AGENT = os.environ.get(
    "WIKIPEDIA_USER_AGENT",
    "OurAtlasPlaceImageService/1.0 (local-development) httpx",
)
# Wikimedia's edge blocks plain Python TLS clients (httpx/requests/urllib) by
# TLS fingerprint (JA3) before it ever inspects headers, even with a
# descriptive User-Agent — curl and real browsers/apps aren't flagged.
# `impersonate="chrome"` makes curl_cffi negotiate a Chrome-shaped TLS
# handshake so the request isn't fingerprinted as a script. See
# PLACE-IMAGE-SERVICE.md Behaviour for the verification that pinned this.
IMPERSONATE_PROFILE = "chrome"


async def fetch(client: AsyncSession, name: str) -> str | None:
    """Return the first Wikipedia thumbnail URL for a place name, if available.

    The wrapper owns provider ordering, shared caching, and exception isolation;
    this source only translates a name into the existing Wikipedia API query.
    """
    query = name.strip()
    if not query:
        return None

    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": query,
        "gsrlimit": "1",
        "prop": "pageimages",
        "pithumbsize": "600",
        "format": "json",
    }

    try:
        resp = await client.get(
            WIKIPEDIA_API,
            params=params,
            headers={"User-Agent": WIKIPEDIA_USER_AGENT},
            timeout=PHOTO_TIMEOUT_S,
            impersonate=IMPERSONATE_PROFILE,
        )
        resp.raise_for_status()
        pages = (resp.json().get("query") or {}).get("pages") or {}
        page = next(iter(pages.values()), None)
        photo_url = (page or {}).get("thumbnail", {}).get("source")
        if photo_url:
            # Log successful provider hits during the migration so we can
            # verify which URL was added to the backend response/cache.
            print(f"[place_image_wiki_api] Added photo_url for '{query}': {photo_url}")
        return photo_url
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        detail = f"HTTP {status}" if status else str(exc)
        print(f"[place_image_wiki_api] Wikipedia lookup failed for '{query}': {detail}")
        return None
