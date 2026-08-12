import unittest

from backend.services.tiktok_places_service import (
    _build_geocode_queries,
    _matches_inferred_region,
    _normalize_tiktok_url,
    _needs_transcription,
    _clean_caption_file,
    _source_text_from_item,
)


class TikTokPlacesTests(unittest.TestCase):
    def test_normalizes_tiktok_short_links_and_rejects_other_hosts(self):
        self.assertEqual(_normalize_tiktok_url("vm.tiktok.com/ZMexample"), "https://vm.tiktok.com/ZMexample")
        with self.assertRaises(ValueError):
            _normalize_tiktok_url("https://example.com/video")

    def test_builds_extraction_text_from_public_video_metadata(self):
        title, text = _source_text_from_item({
            "text": "Three places to eat in Chinatown #nyc #food",
            "authorMeta": {"name": "atlas", "nickName": "Atlas Travel"},
            "hashtags": [{"name": "nyc"}, {"name": "food"}],
            "locationCreated": "New York",
        }, "https://www.tiktok.com/@atlas/video/123")
        self.assertEqual(title, "Three places to eat in Chinatown #nyc #food")
        self.assertIn("Video caption: Three places to eat in Chinatown", text)
        self.assertIn("Hashtags: #nyc #food", text)
        self.assertIn("Creator: @atlas Atlas Travel", text)
        self.assertIn("TikTok location: New York", text)

    def test_geocoding_keeps_video_context(self):
        self.assertEqual(
            _build_geocode_queries([{"name": "Joe's Pizza", "context": "New York"}], "New York"),
            [{"query": "Joe's Pizza, New York", "name": "Joe's Pizza"}],
        )
        self.assertTrue(_matches_inferred_region(
            {"full_address": "7 Carmine Street, New York, NY, United States"}, "New York"
        ))
        self.assertFalse(_matches_inferred_region(
            {"full_address": "101 Sunset Boulevard, Los Angeles, California, United States"}, "New York"
        ))

    def test_transcription_only_runs_for_non_specific_metadata(self):
        self.assertFalse(_needs_transcription({"locations": [{"name": "Eiffel Tower", "hierarchy_level": 0}]}))
        self.assertTrue(_needs_transcription({"locations": [{"name": "Paris", "hierarchy_level": 2}]}))
        self.assertEqual(
            _clean_caption_file("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nVisit the Louvre."),
            "Visit the Louvre.",
        )
