"""Regression tests for live verification routing in Atlas chat."""

import unittest
from unittest.mock import AsyncMock, patch

from backend.langgraph.chat_agent import _agent_tools, _parse_json_object, _requires_live_verification
from backend.services.conversation_manager import conversation_manager


class PrecisePlaceSearchTests(unittest.IsolatedAsyncioTestCase):
    def test_live_verification_covers_restaurant_constraints(self):
        self.assertTrue(_requires_live_verification("Find a highly rated vegetarian restaurant with a breakfast burrito"))
        self.assertTrue(_requires_live_verification("Find a cheap brunch near me"))
        self.assertTrue(_requires_live_verification("找一家评分高的素食餐厅，可以外带早餐"))

    def test_simple_category_stays_on_fast_mapbox_path(self):
        self.assertFalse(_requires_live_verification("Find a coffee shop near me"))

    def test_research_response_accepts_fenced_json(self):
        parsed = _parse_json_object('```json\n{"candidates": [{"name": "Example Cafe"}]}\n```')
        self.assertEqual(parsed["candidates"][0]["name"], "Example Cafe")

    async def test_verified_tool_reports_unverified_commute_without_saved_anchors(self):
        session = conversation_manager.create_session("precise-place-search-test")
        session.user_location = (-122.3321, 47.6062)
        tools = {tool.name: tool for tool in _agent_tools(session, {})}
        with patch("backend.langgraph.chat_agent._research_precise_places", new=AsyncMock(return_value=[{
            "name": "Example Cafe", "address": "Seattle", "why": "Has a vegetarian menu.",
            "rating": "4.7", "price": "$$", "menu_evidence": "Breakfast burrito listed.", "source_urls": ["https://example.com"],
        }])), patch("backend.langgraph.chat_agent._mapbox_resolve_researched_place", new=AsyncMock(return_value={
            "name": "Example Cafe", "latitude": 47.61, "longitude": -122.33,
        })):
            result = await tools["find_verified_places"].ainvoke({
                "requirements": "On my commute, find a highly rated vegetarian breakfast burrito",
            })
        self.assertEqual(result["places"][0]["name"], "Example Cafe")
        self.assertTrue(result["unverified_constraints"])
