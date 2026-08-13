"""Provider configuration tests for single-photo place recognition."""

import asyncio
import os
import unittest
from unittest.mock import patch

from backend.services import find_image_places_service as image_places


class FindImagePlacesProviderTests(unittest.TestCase):
    def test_data_url_preserves_its_image_format(self):
        png = "data:image/png;base64,iVBORw0KGgo="

        self.assertEqual(image_places._to_data_url(png), png)
        self.assertEqual(
            image_places._to_data_url("/9j/4AAQSkZJRg=="),
            "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        )

    def test_uses_mango_provider_and_image_recognition_model(self):
        captured = {}

        class FakeModel:
            def invoke(self, _messages):
                return '{"name":"Space Needle","latitude":47.6205,"longitude":-122.3493,"confidence":0.99}'

        def get_model(**kwargs):
            captured.update(kwargs)
            return FakeModel()

        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY_MANGO": "test-key",
                "OPENAI_MODEL_MANGO_FOR_IMGAE_RECOGNITION": "gpt-4o-mini",
            },
            clear=False,
        ), patch.object(image_places, "OPENAI_VISION_MODEL", "gpt-4o-mini"), patch.object(
            image_places, "get_chat_model", side_effect=get_model
        ):
            result = asyncio.run(image_places._call_gpt4o_vision("aGVsbG8="))

        self.assertEqual(captured["provider"], "openai_mango")
        self.assertEqual(captured["model"], "gpt-4o-mini")
        self.assertEqual(result["name"], "Space Needle")
