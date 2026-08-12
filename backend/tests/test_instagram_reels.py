import unittest

from backend.services.instagram_reels_service import (
    _canonical_instagram_reel_url,
    _matches_inferred_region,
    _needs_transcript,
    _source_text_from_item,
    _trim_duplicate_instagram_url,
)


class InstagramReelsTests(unittest.TestCase):
    def test_recovers_a_duplicated_reel_paste_and_canonicalizes_it(self):
        repeated = "https://www.instagram.com/reel/DbbWUFgjfkb/?igsh=abchttps://www.instagram.com/reel/DbbWUFgjfkb/?igsh=abc"
        self.assertEqual(
            _canonical_instagram_reel_url(_trim_duplicate_instagram_url(repeated)),
            "https://www.instagram.com/reel/DbbWUFgjfkb/",
        )

    def test_rejects_non_reel_instagram_urls(self):
        with self.assertRaises(ValueError):
            _canonical_instagram_reel_url("https://www.instagram.com/p/example/")

    def test_builds_extraction_text_from_reel_metadata_and_transcript(self):
        title, text = _source_text_from_item({
            "caption": "Three dinner stops in Seoul",
            "hashtags": ["seoul", {"name": "food"}],
            "ownerUsername": "atlas",
            "location": {"name": "Seoul, South Korea"},
            "transcript": "Start at Gwangjang Market, then visit Myeongdong Kyoja.",
        }, "https://www.instagram.com/reel/example/")
        self.assertEqual(title, "Three dinner stops in Seoul")
        self.assertIn("Hashtags: #seoul #food", text)
        self.assertIn("Creator: @atlas", text)
        self.assertIn("Instagram location: Seoul, South Korea", text)
        self.assertIn("Reel transcript: Start at Gwangjang Market", text)

    def test_transcript_only_runs_for_non_specific_metadata(self):
        self.assertFalse(_needs_transcript({"locations": [{"name": "Louvre Museum", "hierarchy_level": 0}]}))
        self.assertTrue(_needs_transcript({"locations": [{"name": "Paris", "hierarchy_level": 2}]}))

    def test_accepts_geocoder_city_alias_for_inferred_region(self):
        self.assertTrue(_matches_inferred_region(
            {"full_address": "New York, New York, United States"},
            "New York City",
        ))

    def test_rejects_geocode_outside_inferred_region(self):
        self.assertFalse(_matches_inferred_region(
            {"full_address": "Los Angeles, California, United States"},
            "New York City",
        ))
