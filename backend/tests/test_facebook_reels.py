import unittest

from backend.services.facebook_reels_service import (
    _facebook_video_actor_input,
    _source_thumbnail_from_item,
    _source_text_from_item,
)


class FacebookReelsTests(unittest.TestCase):
    def test_builds_extraction_text_from_direct_video_actor_output(self):
        title, text = _source_text_from_item({
            "title": "Melbourne bucket list",
            "description": "Visit Federation Square and Queen Victoria Market.",
            "uploader": "Visit Melbourne",
            "thumbnail": "https://cdn.example.com/video.jpg",
            "url": "https://www.facebook.com/visitmelbourne/videos/833054929681154/",
        }, "https://www.facebook.com/visitmelbourne/videos/833054929681154/")
        self.assertEqual(title, "Melbourne bucket list")
        self.assertIn("Facebook video URL: https://www.facebook.com/visitmelbourne/videos/833054929681154/", text)
        self.assertIn("Video description: Visit Federation Square and Queen Victoria Market.", text)
        self.assertIn("Uploader: Visit Melbourne", text)
        self.assertEqual(_source_thumbnail_from_item({"thumbnail": "https://cdn.example.com/video.jpg"}), "https://cdn.example.com/video.jpg")

    def test_rejects_actor_items_without_public_text_metadata(self):
        title, text = _source_text_from_item({"thumbnail": "https://cdn.example.com/video.jpg"}, "https://www.facebook.com/reel/123/")
        self.assertEqual(title, "Facebook video")
        self.assertEqual(text, "")

    def test_actor_receives_a_single_url_string(self):
        url = "https://www.facebook.com/reel/123/"
        self.assertEqual(_facebook_video_actor_input(url), {"urls": url})
