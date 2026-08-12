"""Regression tests for live verification routing in Atlas chat."""

import unittest
from unittest.mock import AsyncMock, patch

from backend.langgraph.chat_agent import _agent_tools, _commute_anchors_for_requirements, _parse_json_object, _requires_live_verification
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

    def test_commute_from_my_place_to_office_uses_current_location(self):
        session = conversation_manager.create_session("commute-anchor-office-test")
        self.addCleanup(conversation_manager.delete_session, "commute-anchor-office-test")
        session.user_location = (-122.3321, 47.6062)
        session.special_places = [{
            "role": "office", "name": "Atlas Office", "longitude": -122.30, "latitude": 47.64,
        }]

        anchors = _commute_anchors_for_requirements(
            session,
            "从我的地方出发到我的公司，路上推荐一家 Chinese food",
        )

        self.assertIsNotNone(anchors)
        self.assertEqual(anchors[0]["role"], "current_location")
        self.assertEqual(anchors[1]["role"], "office")

    def test_commute_from_my_place_home_requires_home_not_office(self):
        session = conversation_manager.create_session("commute-anchor-home-test")
        self.addCleanup(conversation_manager.delete_session, "commute-anchor-home-test")
        session.user_location = (-122.3321, 47.6062)
        session.special_places = [{
            "role": "office", "name": "Atlas Office", "longitude": -122.30, "latitude": 47.64,
        }]

        anchors = _commute_anchors_for_requirements(
            session,
            "从我的地方出发回家，路上推荐一家 Chinese food",
        )

        self.assertIsNone(anchors)

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

    async def test_verified_tool_discards_mapbox_matches_farther_than_50km(self):
        session = conversation_manager.create_session("precise-place-distance-test")
        self.addCleanup(conversation_manager.delete_session, "precise-place-distance-test")
        session.user_location = (-122.3321, 47.6062)
        tools = {tool.name: tool for tool in _agent_tools(session, {})}
        with patch("backend.langgraph.chat_agent._research_precise_places", new=AsyncMock(return_value=[{
            "name": "Same Name Restaurant", "address": "Seattle", "why": "Menu evidence.",
            "rating": "4.7", "price": "", "menu_evidence": "Breakfast burrito.", "source_urls": ["https://example.com"],
        }])), patch("backend.langgraph.chat_agent._mapbox_resolve_researched_place", new=AsyncMock(return_value={
            "name": "Same Name Restaurant", "latitude": 45.5152, "longitude": -122.6784,
        })):
            result = await tools["find_verified_places"].ainvoke({
                "requirements": "Find a highly rated vegetarian breakfast burrito",
            })

        self.assertEqual(result["places"], [])
        self.assertIn("within 50 km", result["error"])

    async def test_similar_local_venue_discards_matches_farther_than_50km(self):
        session = conversation_manager.create_session("similar-local-venue-test")
        self.addCleanup(conversation_manager.delete_session, "similar-local-venue-test")
        session.user_location = (-122.3321, 47.6062)
        tools = {tool.name: tool for tool in _agent_tools(session, {})}
        researched = [{
            "name": "Far Away Bistro", "address": "Portland, OR", "why": "Similar menu.",
            "source_urls": ["https://example.com"],
        }]
        far_away = {"name": "Far Away Bistro", "latitude": 45.5152, "longitude": -122.6784}
        with patch("backend.langgraph.chat_agent._research_similar_places", new=AsyncMock(return_value=researched)), patch("backend.langgraph.chat_agent._mapbox_resolve_researched_place", new=AsyncMock(return_value=far_away)):
            result = await tools["find_similar_places"].ainvoke({
                "reference_place": "Example Restaurant", "reference_kind": "local_venue",
            })

        self.assertEqual(result["places"], [])
        self.assertEqual(result["scope"], "local")
        self.assertIn("within 50 km", result["error"])

    async def test_similar_destination_defaults_to_global_results(self):
        session = conversation_manager.create_session("similar-destination-test")
        self.addCleanup(conversation_manager.delete_session, "similar-destination-test")
        session.user_location = (-122.3321, 47.6062)
        state = {}
        tools = {tool.name: tool for tool in _agent_tools(session, state)}
        researched = [{
            "name": "Louvre Museum", "address": "Paris, France", "why": "Major encyclopedic art museum.",
            "source_urls": ["https://example.com"],
        }]
        louvre = {"name": "Louvre Museum", "latitude": 48.8606, "longitude": 2.3376}
        with patch("backend.langgraph.chat_agent._research_similar_places", new=AsyncMock(return_value=researched)), patch("backend.langgraph.chat_agent._mapbox_resolve_researched_place", new=AsyncMock(return_value=louvre)):
            result = await tools["find_similar_places"].ainvoke({
                "reference_place": "Metropolitan Museum of Art", "reference_kind": "destination",
            })

        self.assertEqual(result["scope"], "global")
        self.assertEqual([place["name"] for place in result["places"]], ["Louvre Museum"])
        self.assertEqual(state["presentation"]["kind"], "places_map")

    async def test_similar_local_venue_honors_an_explicit_city_scope(self):
        session = conversation_manager.create_session("similar-local-area-test")
        self.addCleanup(conversation_manager.delete_session, "similar-local-area-test")
        session.user_location = (-122.3321, 47.6062)
        tools = {tool.name: tool for tool in _agent_tools(session, {})}
        researched = [{
            "name": "New York Bistro", "address": "New York, NY", "why": "Similar menu.",
            "source_urls": ["https://example.com"],
        }]
        new_york = {"name": "New York Bistro", "latitude": 40.7128, "longitude": -74.0060}
        with patch("backend.langgraph.chat_agent._research_similar_places", new=AsyncMock(return_value=researched)) as research, patch("backend.langgraph.chat_agent._mapbox_resolve_researched_place", new=AsyncMock(return_value=new_york)):
            result = await tools["find_similar_places"].ainvoke({
                "reference_place": "Example Restaurant", "reference_kind": "local_venue", "area": "New York City",
            })

        self.assertEqual(result["scope"], "area")
        self.assertEqual([place["name"] for place in result["places"]], ["New York Bistro"])
        self.assertEqual(research.await_args.args[3], "area")

    async def test_commute_result_keeps_a_direct_route_to_the_destination(self):
        session = conversation_manager.create_session("precise-commute-presentation-test")
        self.addCleanup(conversation_manager.delete_session, "precise-commute-presentation-test")
        session.user_location = (-122.3321, 47.6062)
        session.special_places = [{
            "role": "office", "name": "Atlas Office", "longitude": -122.30, "latitude": 47.64,
        }]
        state = {}
        tools = {tool.name: tool for tool in _agent_tools(session, state)}
        restaurant = {"name": "Noodle House", "latitude": 47.62, "longitude": -122.32}
        direct_route = {"route": {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []}}, "duration_minutes": 10}
        with patch("backend.langgraph.chat_agent._research_precise_places", new=AsyncMock(return_value=[{
            "name": "Noodle House", "address": "Seattle", "why": "Chinese food.",
            "rating": "4.7", "price": "", "menu_evidence": "", "source_urls": ["https://example.com"],
        }])), patch("backend.langgraph.chat_agent._mapbox_resolve_researched_place", new=AsyncMock(return_value=restaurant)), patch("backend.langgraph.chat_agent._rank_by_commute_detour", new=AsyncMock(return_value=([restaurant], None))), patch("backend.langgraph.chat_agent._road_route", new=AsyncMock(side_effect=[direct_route, None])):
            result = await tools["find_verified_places"].ainvoke({
                "requirements": "从我的地方出发到我的公司，路上给我推荐家 Chinese food",
            })

        self.assertEqual(result["commute_route"], direct_route)
        self.assertEqual([anchor["role"] for anchor in result["special_places"]], ["office"])
        self.assertEqual(state["presentation"]["commute_route"], direct_route)
