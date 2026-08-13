"""Category-themed stock imagery for events that carry no photograph of their own.

Third in the image chain, behind an event's own photo and its park's photo. A
farmers market and a curated festival have no imagery anywhere upstream — USDA
publishes only a shared placeholder filename, and the curated file is
hand-written — so without this the most prominent surface in Discover is a wall
of flat colour blocks.

**Licence.** These are hotlinked Unsplash CDN URLs, used under the Unsplash
Licence: free for commercial use, no permission and no attribution required.
This is deliberately *not* the Unsplash API, which carries extra obligations
(an API key, triggering their download endpoint, and mandatory attribution) and
would put a third-party key in the request path for a purely decorative asset.
Every URL below was fetched and confirmed to return `image/jpeg`.

The image is generic to the category, never specific to the event, so it must
never be presented as a photograph *of* the event — `image_attribution` marks
it so a caller can caption it honestly.
"""

from __future__ import annotations

import hashlib

SOURCE_ID = "unsplash"
ATTRIBUTION = "Unsplash"

# Requested at a size the featured card and the detail hero can both use, with
# `auto=format` so the CDN serves WebP where the client supports it.
_PARAMS = "w=800&q=80&auto=format&fit=crop"

# Several per category so a screen full of markets does not repeat one photo.
_PHOTOS: dict[str, tuple[str, ...]] = {
    "market": (
        "photo-1526399743290-f73cb4022f48",
        "photo-1485637701894-09ad422f6de6",
        "photo-1514425263458-109317cc1321",
        "photo-1471193945509-9ad0617afabf",
        "photo-1488459716781-31db52582fe9",
    ),
    "festival": (
        "photo-1603228254119-e6a4d095dc59",
        "photo-1474513312726-8d86a8bcbaec",
        "photo-1588012646950-71779e6e4295",
        "photo-1576646619495-4106b262ebbd",
        "photo-1588006775388-4372241c3d6c",
    ),
    "music": (
        "photo-1459749411175-04bf5292ceea",
        "photo-1470229722913-7c0e2dbbafd3",
        "photo-1429962714451-bb934ecdc4ec",
        "photo-1524368535928-5b5e00ddc76b",
        "photo-1501386761578-eac5c94b800a",
    ),
    "arts": (
        "photo-1569783721854-33a99b4c0bae",
        "photo-1582555172866-f73bb12a2ab3",
        "photo-1578855019520-af8101c056e2",
        "photo-1563293743-a9761195b52e",
        "photo-1598154948139-a899dadb6269",
    ),
    "community": (
        "photo-1628717341663-0007b0ee2597",
        "photo-1593113616828-6f22bca04804",
        "photo-1544928938-6852c1925194",
        "photo-1560220604-1985ebfe28b1",
    ),
    "outdoors": (
        "photo-1507041957456-9c397ce39c97",
        "photo-1516214104703-d870798883c5",
        "photo-1487525219605-eadb39ae229c",
        "photo-1540486674504-91e3ad500c52",
    ),
    "history": (
        "photo-1575460304596-606035eff550",
        "photo-1642413257857-6955f09dc8c7",
        "photo-1641780137883-92dc502bca80",
        "photo-1636865266989-58043bceaa71",
    ),
}


def image_for(category: str, event_id: str) -> str | None:
    """A themed photo for `category`, chosen deterministically from `event_id`.

    Keyed on the event rather than rotated by a counter so the same event keeps
    the same picture across requests and processes — a market whose photo
    changed on every pull-to-refresh would read as a different market.
    """
    photos = _PHOTOS.get(category)
    if not photos:
        return None
    digest = hashlib.sha1(event_id.encode("utf-8")).digest()
    photo = photos[digest[0] % len(photos)]
    return f"https://images.unsplash.com/{photo}?{_PARAMS}"
