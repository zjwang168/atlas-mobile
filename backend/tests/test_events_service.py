"""Tests for the events service: identity, the coordinate contract, and the
degradation rules a client depends on.

Every source is stubbed. The point of these is the orchestration logic, not
whether USDA is up — the live sources are exercised by hitting `/events`.
"""

import unittest
from datetime import date
from unittest.mock import patch

from backend.services.events_service import events_service
from backend.services.events_service.models import (
    CATEGORIES, dedupe, event_row, haversine_km,
)
from backend.services.events_service.sources import curated, nps, stock_imagery


def market(ident, title, lat, lng, **kwargs):
    return event_row("usda", ident, title, category="market",
                     latitude=lat, longitude=lng, **kwargs)


def park_event(ident, title, lat, lng, starts_at=None, **kwargs):
    return event_row("nps", ident, title, category="history", latitude=lat,
                     longitude=lng, starts_at=starts_at, **kwargs)


class DedupeTests(unittest.TestCase):
    def test_usda_spelling_variants_of_one_market_collapse(self):
        """The exact rows the live feed returns for 14th & U."""
        rows = [
            market("usda:1", "14 & U Farmers' Market", 38.917000, -77.031950),
            market("usda:2", "14 and U Market NW Farmers' Market", 38.917000, -77.031950),
            market("usda:3", "14&U Farmers' Market", 38.917089, -77.031900),
        ]
        self.assertEqual(len(dedupe(rows)), 1)

    def test_same_market_geocoded_120m_apart_still_collapses(self):
        """Just outside the 100m rule, but the identity tokens are identical."""
        a = market("usda:1", "Mount Vernon Triangle FreshFarm Market", 38.9010, -77.0180)
        b = market("usda:2", "FRESHFARM Mount Vernon Triangle", 38.9021, -77.0180)
        self.assertGreater(
            haversine_km(a["latitude"], a["longitude"], b["latitude"], b["longitude"]),
            0.111,
        )
        self.assertEqual(len(dedupe([a, b])), 1)

    def test_distinct_markets_at_different_places_survive(self):
        rows = [
            market("usda:1", "Dupont Circle FreshFarm Market", 38.9096, -77.0434),
            market("usda:2", "FreshFarm Market by the White House", 38.8990, -77.0365),
        ]
        self.assertEqual(len(dedupe(rows)), 2)

    def test_one_event_listed_under_two_parks_collapses(self):
        """NPS files a joint programme under every participating park code."""
        rows = [
            park_event("nps:a", "National Junior Ranger Day", 38.8823, -77.0722,
                       starts_at="2026-08-22T10:00:00-04:00"),
            park_event("nps:b", "National Junior Ranger Day", 38.8823, -77.0722,
                       starts_at="2026-08-22T10:00:00-04:00", image_url="x.jpg"),
        ]
        survivors = dedupe(rows)
        self.assertEqual(len(survivors), 1)
        # The survivor borrows what it was missing from the row it absorbed.
        self.assertEqual(survivors[0]["image_url"], "x.jpg")

    def test_weekday_series_of_one_tour_collapses_to_the_soonest(self):
        """Three weekday series of the same walking tour are one listing."""
        rows = [
            park_event("nps:wed", "Ford's Theatre Walking Tour", 38.8967, -77.0257,
                       starts_at="2026-08-26T14:00:00-04:00"),
            park_event("nps:mon", "Ford's Theatre Walking Tour", 38.8967, -77.0257,
                       starts_at="2026-08-24T14:00:00-04:00"),
            park_event("nps:fri", "Ford's Theatre Walking Tour", 38.8967, -77.0257,
                       starts_at="2026-08-28T14:00:00-04:00"),
        ]
        survivors = dedupe(rows)
        self.assertEqual(len(survivors), 1)
        self.assertEqual(survivors[0]["starts_at"], "2026-08-24T14:00:00-04:00")

    def test_different_programmes_at_one_park_are_not_merged(self):
        """Co-located park events are distinct things to go to, unlike markets."""
        rows = [
            park_event("nps:a", "Boat Rides at Great Falls", 39.0000, -77.2470,
                       starts_at="2026-08-22T11:00:00-04:00"),
            park_event("nps:b", "Lock Demos at Great Falls", 39.0000, -77.2470,
                       starts_at="2026-08-22T13:00:00-04:00"),
        ]
        self.assertEqual(len(dedupe(rows)), 2)

    def test_rows_without_coordinates_never_match(self):
        rows = [
            market("usda:1", "Same Name Market", None, None),
            market("usda:2", "Same Name Market", None, None),
        ]
        self.assertEqual(len(dedupe(rows)), 2)


class CuratedWindowTests(unittest.TestCase):
    def test_entry_appears_only_when_its_annual_window_overlaps(self):
        entry = {
            "id": "x", "title": "Test Festival", "category": "festival",
            "annual_window": {"start": "08-22", "end": "10-25"},
            "latitude": 39.0, "longitude": -76.6, "schedule_text": "Weekends",
        }
        inside = curated._to_event(entry, date(2026, 8, 20), date(2026, 9, 19))
        outside = curated._to_event(entry, date(2026, 2, 1), date(2026, 3, 3))
        self.assertIsNotNone(inside)
        self.assertIsNone(outside)

    def test_window_that_wraps_new_year_is_matched(self):
        """Georgetown GLOW runs 12-01 to 01-05; its start is after its end."""
        entry = {
            "id": "glow", "title": "Winter Lights", "category": "arts",
            "annual_window": {"start": "12-01", "end": "01-05"},
            "latitude": 38.9, "longitude": -77.06,
        }
        self.assertIsNotNone(curated._to_event(entry, date(2026, 12, 20), date(2027, 1, 2)))
        self.assertIsNotNone(curated._to_event(entry, date(2027, 1, 2), date(2027, 1, 4)))
        self.assertIsNone(curated._to_event(entry, date(2026, 7, 1), date(2026, 7, 30)))

    def test_curated_rows_are_recurring_shaped(self):
        """Never a fabricated date — schedule text instead."""
        entry = {
            "id": "x", "title": "Test Festival", "category": "festival",
            "annual_window": {"start": "01-01", "end": "12-31"},
            "latitude": 39.0, "longitude": -76.6,
            "schedule_text": "Weekends, late August through late October",
        }
        row = curated._to_event(entry, date(2026, 8, 20), date(2026, 9, 19))
        self.assertIsNone(row["starts_at"])
        self.assertEqual(row["schedule_text"],
                         "Weekends, late August through late October")

    def test_shipped_data_file_is_complete(self):
        """Every committed entry must be renderable: coordinates and a window."""
        entries = curated._load()
        self.assertGreater(len(entries), 20)
        for entry in entries:
            with self.subTest(entry=entry["id"]):
                self.assertIsNotNone(entry.get("latitude"))
                self.assertIsNotNone(entry.get("longitude"))
                self.assertIn("start", entry.get("annual_window", {}))
                # Inside the DMV, generously bounded.
                self.assertTrue(37.8 <= entry["latitude"] <= 40.0)
                self.assertTrue(-78.6 <= entry["longitude"] <= -75.9)


class NpsOccurrenceTests(unittest.TestCase):
    def test_only_the_next_occurrence_inside_the_window_is_emitted(self):
        item = {
            "id": "abc", "title": "Chicken Feeding", "sitecode": "oxhi",
            "latitude": "38.80", "longitude": "-77.00",
            "dates": ["2026-08-10", "2026-08-14", "2026-08-15", "2026-09-30"],
            "times": [{"timestart": "10:00 AM", "timeend": "10:30 AM"}],
        }
        row = nps._to_event(item, date(2026, 8, 13), date(2026, 8, 20))
        self.assertTrue(row["starts_at"].startswith("2026-08-14T10:00"))
        self.assertTrue(row["ends_at"].startswith("2026-08-14T10:30"))

    def test_series_with_no_occurrence_in_window_is_dropped(self):
        item = {
            "id": "abc", "title": "Old Event", "sitecode": "oxhi",
            "latitude": "38.80", "longitude": "-77.00",
            "dates": ["2020-01-01"], "times": [],
        }
        self.assertIsNone(nps._to_event(item, date(2026, 8, 13), date(2026, 8, 20)))

    def test_date_without_a_usable_time_keeps_the_date(self):
        """Midnight is the backend's "date known, time unknown"."""
        item = {
            "id": "abc", "title": "All Day Thing", "sitecode": "nama",
            "latitude": "38.88", "longitude": "-77.02",
            "dates": ["2026-08-15"], "times": [],
        }
        row = nps._to_event(item, date(2026, 8, 13), date(2026, 8, 20))
        self.assertTrue(row["starts_at"].startswith("2026-08-15T00:00"))

    def test_zero_coordinates_are_treated_as_missing(self):
        """Null island is never a DMV park."""
        item = {
            "id": "abc", "title": "Somewhere", "sitecode": "nama",
            "latitude": "0", "longitude": "0",
            "dates": ["2026-08-15"], "times": [],
        }
        row = nps._to_event(item, date(2026, 8, 13), date(2026, 8, 20))
        self.assertIsNone(row["latitude"])


class StockImageryTests(unittest.TestCase):
    def test_same_event_always_gets_the_same_photo(self):
        """Keyed on the event, not rotated by a counter — a market whose photo
        changed on every refresh would read as a different market."""
        first = stock_imagery.image_for("market", "usda:311197")
        again = stock_imagery.image_for("market", "usda:311197")
        self.assertEqual(first, again)
        self.assertIn("images.unsplash.com", first)

    def test_neighbouring_events_do_not_all_share_one_photo(self):
        urls = {
            stock_imagery.image_for("market", f"usda:{i}") for i in range(40)
        }
        self.assertGreater(len(urls), 1)

    def test_every_category_has_imagery(self):
        for category in CATEGORIES:
            with self.subTest(category=category):
                self.assertIsNotNone(stock_imagery.image_for(category, "x:1"))

    def test_unknown_category_yields_nothing_rather_than_a_wrong_photo(self):
        self.assertIsNone(stock_imagery.image_for("not-a-category", "x:1"))


class OrchestrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        events_service.clear_cache()

    async def _run(self, usda_rows=None, nps_rows=None, curated_rows=None,
                   usda_error=None, nps_error=None, curated_error=None, **kwargs):
        async def fake_usda(*_a, **_k):
            if usda_error:
                raise usda_error
            return list(usda_rows or [])

        async def fake_nps(*_a, **_k):
            if nps_error:
                raise nps_error
            return list(nps_rows or [])

        def fake_curated(*_a, **_k):
            if curated_error:
                raise curated_error
            return list(curated_rows or [])

        with patch.object(events_service.usda, "fetch", fake_usda), \
             patch.object(events_service.usda, "is_configured", lambda: True), \
             patch.object(events_service.nps, "fetch", fake_nps), \
             patch.object(events_service.nps, "is_configured", lambda: True), \
             patch.object(events_service.curated, "fetch", fake_curated), \
             patch.object(events_service.curated, "is_configured", lambda: True):
            return await events_service.get_events(38.9072, -77.0369, **kwargs)

    async def test_rows_without_coordinates_are_dropped_not_placed_at_zero(self):
        result = await self._run(usda_rows=[
            market("usda:1", "Placed Market", 38.91, -77.03),
            market("usda:2", "Unplaced Market", None, None),
        ])
        titles = [e["title"] for e in result["events"]]
        self.assertEqual(titles, ["Placed Market"])
        # The source still reports only what it could place.
        usda_status = next(s for s in result["sources"] if s["id"] == "usda")
        self.assertEqual(usda_status["count"], 1)

    async def test_events_outside_the_radius_are_excluded(self):
        result = await self._run(
            usda_rows=[
                market("usda:near", "Near Market", 38.91, -77.03),
                market("usda:far", "Baltimore Market", 39.29, -76.61),
            ],
            radius_km=40,
        )
        self.assertEqual([e["title"] for e in result["events"]], ["Near Market"])

    async def test_one_source_failing_still_serves_the_others(self):
        result = await self._run(
            usda_rows=[market("usda:1", "Market", 38.91, -77.03)],
            nps_error=RuntimeError("upstream 502"),
        )
        self.assertEqual(len(result["events"]), 1)
        statuses = {s["id"]: s["status"] for s in result["sources"]}
        self.assertEqual(statuses["usda"], "ok")
        self.assertEqual(statuses["nps"], "unavailable")

    async def test_every_source_failing_raises(self):
        with self.assertRaises(events_service.EventsUnavailable):
            await self._run(
                usda_error=RuntimeError("down"),
                nps_error=RuntimeError("down"),
                curated_error=RuntimeError("data file unreadable"),
            )

    async def test_a_source_returning_nothing_is_still_a_working_source(self):
        """Empty is an answer. Only an exception makes a source unavailable."""
        result = await self._run(usda_rows=[], nps_rows=[], curated_rows=[])
        self.assertEqual(result["events"], [])
        self.assertTrue(all(s["status"] == "ok" for s in result["sources"]))

    async def test_unconfigured_source_is_reported_not_hidden(self):
        async def fake_usda(*_a, **_k):
            return [market("usda:1", "Market", 38.91, -77.03)]

        with patch.object(events_service.usda, "fetch", fake_usda), \
             patch.object(events_service.usda, "is_configured", lambda: True), \
             patch.object(events_service.nps, "is_configured", lambda: False), \
             patch.object(events_service.curated, "is_configured", lambda: False):
            result = await events_service.get_events(38.9072, -77.0369)

        statuses = {s["id"]: s["status"] for s in result["sources"]}
        self.assertEqual(statuses["nps"], "not_configured")

    async def test_limit_is_never_exceeded_even_with_featured_rows(self):
        rows = [
            market(f"usda:{i}", f"Market {i}", 38.90 + i / 1000, -77.03)
            for i in range(30)
        ]
        featured = [
            event_row("curated", f"curated:{i}", f"Festival {i}", category="festival",
                      latitude=38.95, longitude=-77.05, featured=True)
            for i in range(20)
        ]
        result = await self._run(usda_rows=rows, curated_rows=featured, limit=5)
        self.assertEqual(len(result["events"]), 5)

    async def test_featured_rows_survive_a_limit_that_would_cut_them(self):
        """A signature festival must not be pushed out by nearer markets."""
        # Spaced past the co-location threshold: USDA rows sharing a point are
        # one market by design, so a tighter spread would collapse to a single
        # row and test nothing about the limit.
        near_markets = [
            market(f"usda:{i}", f"Market {i}", 38.9072 + i / 1000, -77.0369)
            for i in range(40)
        ]
        far_festival = event_row(
            "curated", "curated:rennfest", "Maryland Renaissance Festival",
            category="festival", latitude=39.0018, longitude=-76.5838, featured=True,
        )
        result = await self._run(
            usda_rows=near_markets, curated_rows=[far_festival],
            limit=10, radius_km=80,
        )
        titles = [e["title"] for e in result["events"]]
        self.assertEqual(len(titles), 10)
        self.assertIn("Maryland Renaissance Festival", titles)

    async def test_curated_signature_events_outrank_nearer_featured_feed_rows(self):
        """NPS marks a third of its feed "Special Event", routine talks included.
        Those must not crowd the curated set out of the protected slots."""
        nps_specials = [
            park_event(f"nps:{i}", f"Ranger Talk {i}", 38.9080 + i / 10000, -77.0369,
                       starts_at="2026-08-20T10:00:00-04:00", featured=True)
            for i in range(20)
        ]
        rennfest = event_row(
            "curated", "curated:rennfest", "Maryland Renaissance Festival",
            category="festival", latitude=39.0018, longitude=-76.5838, featured=True,
        )
        result = await self._run(
            nps_rows=nps_specials, curated_rows=[rennfest], limit=8, radius_km=60,
        )
        titles = [e["title"] for e in result["events"]]
        self.assertIn("Maryland Renaissance Festival", titles)
        self.assertEqual(len(titles), 8)

    async def test_category_filter_narrows_the_list(self):
        result = await self._run(
            usda_rows=[market("usda:1", "Market", 38.91, -77.03)],
            curated_rows=[event_row("curated", "curated:1", "Festival",
                                    category="festival", latitude=38.92,
                                    longitude=-77.04)],
            categories=["festival"],
        )
        self.assertEqual([e["title"] for e in result["events"]], ["Festival"])

    async def test_soonest_sort_puts_recurring_rows_last(self):
        result = await self._run(
            usda_rows=[market("usda:1", "Recurring Market", 38.9073, -77.0370)],
            nps_rows=[park_event("nps:1", "Dated Talk", 38.95, -77.10,
                                 starts_at="2026-09-01T10:00:00-04:00")],
            sort="soonest",
        )
        self.assertEqual([e["title"] for e in result["events"]],
                         ["Dated Talk", "Recurring Market"])

    async def test_distance_is_measured_from_the_caller_not_the_source(self):
        result = await self._run(
            usda_rows=[market("usda:1", "Market", 38.9172, -77.0369)],
        )
        # ~1.11 km due north of the query point.
        self.assertAlmostEqual(result["events"][0]["distance_km"], 1.11, places=1)

    async def test_a_real_photo_is_never_replaced_by_stock(self):
        row = park_event("nps:1", "Talk", 38.91, -77.03,
                         starts_at="2026-09-01T10:00:00-04:00")
        row["image_url"] = "https://www.nps.gov/real.jpg"
        row["image_attribution"] = "NPS"
        result = await self._run(nps_rows=[row])
        event = result["events"][0]
        self.assertEqual(event["image_url"], "https://www.nps.gov/real.jpg")
        self.assertFalse(event["image_is_stock"])
        self.assertEqual(event["image_attribution"], "NPS")

    async def test_a_photoless_event_falls_back_to_category_stock(self):
        result = await self._run(
            usda_rows=[market("usda:1", "Market", 38.91, -77.03)],
        )
        event = result["events"][0]
        self.assertIn("images.unsplash.com", event["image_url"])
        self.assertTrue(event["image_is_stock"])
        # Not attributed: the picture is of the category, not of this market.
        self.assertIsNone(event["image_attribution"])

    async def test_a_merged_row_keeps_the_real_photo_over_stock(self):
        """Stock runs after dedupe, so a row that borrowed a sibling's photo
        must not then be handed a generic one."""
        plain = park_event("nps:a", "Junior Ranger Day", 38.8823, -77.0722,
                           starts_at="2026-08-22T10:00:00-04:00")
        with_photo = park_event("nps:b", "Junior Ranger Day", 38.8823, -77.0722,
                                starts_at="2026-08-22T10:00:00-04:00")
        with_photo["image_url"] = "https://www.nps.gov/real.jpg"
        result = await self._run(nps_rows=[plain, with_photo])
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(result["events"][0]["image_url"], "https://www.nps.gov/real.jpg")
        self.assertFalse(result["events"][0]["image_is_stock"])

    async def test_internal_fields_do_not_leak_to_the_client(self):
        row = park_event("nps:1", "Talk", 38.91, -77.03,
                         starts_at="2026-09-01T10:00:00-04:00")
        row["_sitecode"] = "nama"
        result = await self._run(nps_rows=[row])
        self.assertNotIn("_sitecode", result["events"][0])


if __name__ == "__main__":
    unittest.main()
