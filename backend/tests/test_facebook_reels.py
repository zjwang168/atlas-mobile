import unittest

from backend.services.facebook_reels_service import (
    _caption_urls,
    _clean_caption_file,
    _needs_captions,
    _source_text_from_item,
)


class FacebookReelsTests(unittest.TestCase):
    def test_builds_extraction_text_from_actor_output(self):
        title, text = _source_text_from_item({
            "text": "Eat at a few great places in Lisbon",
            "facebookUrl": "https://www.facebook.com/atlas",
            "shareable_url": "https://www.facebook.com/reel/123",
        }, "https://www.facebook.com/share/v/example/")
        self.assertEqual(title, "Eat at a few great places in Lisbon")
        self.assertIn("Facebook Reel URL: https://www.facebook.com/reel/123", text)
        self.assertIn("Creator page: https://www.facebook.com/atlas", text)

    def test_reads_and_cleans_public_caption_urls(self):
        item = {
            "playback_video": {
                "captions_url": "https://cdn.example.com/main.srt",
                "video_available_captions_locales": [
                    {"captions_url": "https://cdn.example.com/en.srt"},
                    {"captions_url": "https://cdn.example.com/main.srt"},
                ],
            },
        }
        self.assertEqual(_caption_urls(item), ["https://cdn.example.com/main.srt", "https://cdn.example.com/en.srt"])
        self.assertEqual(
            _clean_caption_file("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nVisit Time Out Market."),
            "Visit Time Out Market.",
        )

    def test_captions_only_run_for_non_specific_metadata(self):
        self.assertFalse(_needs_captions({"locations": [{"name": "Time Out Market", "hierarchy_level": 0}]}))
        self.assertTrue(_needs_captions({"locations": [{"name": "Lisbon", "hierarchy_level": 2}]}))
