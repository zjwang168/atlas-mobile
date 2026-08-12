"""Regression coverage for Responses API content-block extraction."""

import unittest

from backend.services.llm_client import _extract_message_text


class ResponsesContentTests(unittest.TestCase):
    def test_extracts_final_text_after_reasoning_and_web_search(self):
        content = [
            {"type": "reasoning", "encrypted_content": "opaque"},
            {"type": "web_search_call", "status": "completed"},
            {"type": "text", "text": '{"places": [{"name": "Jiaxiu Pavilion"}]}'},
        ]

        self.assertEqual(
            _extract_message_text(content),
            '{"places": [{"name": "Jiaxiu Pavilion"}]}',
        )

    def test_leaves_plain_text_unchanged(self):
        self.assertEqual(_extract_message_text('{"places": []}'), '{"places": []}')
