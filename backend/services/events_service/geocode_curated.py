#!/usr/bin/env python3
"""One-time geocoder for data/dmv_signature_events.json.

Run after adding or editing a curated entry's `address`; it fills in the
`latitude`/`longitude` the events service then serves without any lookup at
request time.

    python3 -m backend.services.events_service.geocode_curated          # dry run
    python3 -m backend.services.events_service.geocode_curated --write

Uses Nominatim rather than the app's own geocoder cascade or Mapbox, and that
is a licensing choice, not a convenience one: this script writes coordinates
into a file we commit and redistribute, and OpenStreetMap data is ODbL, so
storing it is permitted with attribution. The Mapbox Geocoding terms do not
allow storing results from the standard endpoint, which rules it out for a
committed file no matter how much better its DC coverage is.

Nominatim's usage policy caps automated use at one request per second and
requires a real User-Agent. Both are honoured below. Thirty-five entries take
about forty seconds; this is not a hot path and never runs in the server.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data",
                         "dmv_signature_events.json")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Nominatim's usage policy requires a User-Agent that identifies the
# application and gives them a way to reach whoever is running it. A project
# URL satisfies that, so the default carries no individual's address — set
# NOMINATIM_CONTACT to an email if you would rather they mail a person.
DEFAULT_CONTACT = "https://github.com/zjwang168/atlas-mobile"
CONTACT = os.environ.get("NOMINATIM_CONTACT") or DEFAULT_CONTACT
USER_AGENT = f"AtlasTravelApp/1.0 (curated-events-geocoder; {CONTACT})"

# Nominatim's policy is one request per second for automated clients.
DELAY_S = 1.1

# The DMV, generously bounded. A curated entry that geocodes outside this is a
# bad address rather than a distant event — every entry in the file is chosen
# for being within driving distance of DC.
BOUNDS = {"min_lat": 37.8, "max_lat": 40.0, "min_lng": -78.6, "max_lng": -75.9}


def geocode(address: str) -> tuple[float, float] | None:
    query = urllib.parse.urlencode(
        {"q": address, "format": "json", "limit": 1, "countrycodes": "us"}
    )
    request = urllib.request.Request(
        f"{NOMINATIM_URL}?{query}", headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        results = json.loads(response.read().decode("utf-8"))
    if not results:
        return None
    return float(results[0]["lat"]), float(results[0]["lon"])


def in_bounds(lat: float, lng: float) -> bool:
    return (
        BOUNDS["min_lat"] <= lat <= BOUNDS["max_lat"]
        and BOUNDS["min_lng"] <= lng <= BOUNDS["max_lng"]
    )


def main() -> int:
    write = "--write" in sys.argv[1:]
    force = "--force" in sys.argv[1:]

    with open(DATA_PATH, encoding="utf-8") as handle:
        payload = json.load(handle)

    events = payload["events"]
    resolved = failed = skipped = 0

    for event in events:
        if not force and event.get("latitude") is not None:
            skipped += 1
            continue

        address = event.get("address")
        print(f"  {event['id']:<34} {address}")
        try:
            hit = geocode(address)
        except Exception as exc:  # noqa: BLE001 - a one-shot script; report and move on
            print(f"      ! request failed: {exc}")
            failed += 1
            time.sleep(DELAY_S)
            continue

        if hit is None:
            print("      ! no match")
            failed += 1
        elif not in_bounds(*hit):
            # Left unset rather than written: a coordinate in the wrong state
            # would put the row in the list at a plausible-looking distance,
            # which is worse than the row being absent.
            print(f"      ! out of DMV bounds: {hit[0]:.4f}, {hit[1]:.4f} — rejected")
            failed += 1
        else:
            event["latitude"], event["longitude"] = round(hit[0], 6), round(hit[1], 6)
            print(f"      -> {event['latitude']}, {event['longitude']}")
            resolved += 1

        time.sleep(DELAY_S)

    print(f"\nresolved {resolved}   failed {failed}   already set {skipped}   "
          f"total {len(events)}")

    if not write:
        print("\n(dry run; pass --write to update the file)")
        return 0

    with open(DATA_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"\nwrote {DATA_PATH}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
