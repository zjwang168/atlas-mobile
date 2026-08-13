"""The signature layer: hand-curated DMV festivals, parades, and markets.

Every free feed surveyed covers either a single institution's own programming
or one narrow vertical. None of them carries the annual festivals a visitor
would actually plan a weekend around — the Renaissance Festival, Cherry
Blossom, Fiesta DC, Artscape — because each lives only on its own site behind
a client-rendered page. This file is where those live instead.

The rows are honest about what they are: `source` is `"curated"` on every one,
so a client can label them, and none of them claims a precise date. An annual
festival shifts by a week or two each year, so an entry carries an approximate
annual window plus human schedule text and is emitted in the same recurring
shape a farmers market uses — `starts_at` null, `schedule_text` set.
"""

from __future__ import annotations

import functools
import json
import logging
import os
from datetime import date
from typing import Optional

from backend.services.events_service.models import event_row

logger = logging.getLogger("atlas.events.curated")

SOURCE_ID = "curated"

DATA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data", "dmv_signature_events.json"
)


def is_configured() -> bool:
    return os.path.exists(DATA_PATH)


@functools.lru_cache(maxsize=1)
def _load() -> list[dict]:
    """Read once per process. The file is committed and never changes at runtime."""
    with open(DATA_PATH, encoding="utf-8") as handle:
        payload = json.load(handle)
    entries = payload.get("events") or []
    usable = [e for e in entries if e.get("latitude") is not None]
    if len(usable) != len(entries):
        # An entry without coordinates never reaches a client, so surface it
        # here rather than letting the list quietly shrink.
        missing = [e.get("id") for e in entries if e.get("latitude") is None]
        logger.warning("[curated] %d entries lack coordinates and are unusable: %s",
                       len(missing), ", ".join(str(m) for m in missing))
    return usable


def fetch(window_start: date, window_end: date) -> list[dict]:
    """Curated entries whose annual window overlaps the requested window.

    Synchronous because it is a file read, not a network call — the
    orchestrator runs it off the event loop's critical path anyway.
    """
    return [
        row
        for row in (
            _to_event(entry, window_start, window_end) for entry in _load()
        )
        if row is not None
    ]


def _to_event(entry: dict, window_start: date, window_end: date) -> Optional[dict]:
    window = entry.get("annual_window") or {}
    if not _overlaps(window.get("start"), window.get("end"), window_start, window_end):
        return None

    return event_row(
        source=SOURCE_ID,
        ident=f"{SOURCE_ID}:{entry['id']}",
        title=entry["title"],
        category=entry.get("category", "festival"),
        # Deliberately undated — see the module docstring.
        schedule_text=entry.get("schedule_text"),
        location_name=entry.get("location_name"),
        address=entry.get("address"),
        latitude=entry.get("latitude"),
        longitude=entry.get("longitude"),
        url=entry.get("url"),
        blurb=entry.get("blurb"),
        is_free=entry.get("is_free"),
        featured=bool(entry.get("featured")),
    )


def _overlaps(
    start_md: Optional[str],
    end_md: Optional[str],
    window_start: date,
    window_end: date,
) -> bool:
    """Does an annual MM-DD range touch the requested date window?

    Handles the wrap case — Georgetown GLOW runs 12-01 to 01-05, so its start
    is numerically after its end and a naive comparison would never match it.
    """
    if not start_md or not end_md:
        return False

    # A query window can itself straddle a year boundary, so every year the
    # window touches has to be tried.
    for year in range(window_start.year, window_end.year + 1):
        for span in _spans_for_year(start_md, end_md, year):
            if span[0] <= window_end and span[1] >= window_start:
                return True
    return False


def _spans_for_year(start_md: str, end_md: str, year: int) -> list[tuple[date, date]]:
    start = _to_date(start_md, year)
    end = _to_date(end_md, year)
    if start is None or end is None:
        return []
    if start <= end:
        return [(start, end)]
    # Wraps past New Year: it is really two spans touching this year — the tail
    # of last year's run and the head of this year's.
    tail_start = _to_date(start_md, year - 1)
    head_end = _to_date(end_md, year)
    spans = []
    if tail_start is not None and head_end is not None:
        spans.append((tail_start, head_end))
    next_end = _to_date(end_md, year + 1)
    if next_end is not None:
        spans.append((start, next_end))
    return spans


def _to_date(month_day: str, year: int) -> Optional[date]:
    try:
        month, day = month_day.split("-")
        return date(year, int(month), int(day))
    except (AttributeError, ValueError):
        return None
