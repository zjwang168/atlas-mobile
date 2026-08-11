import unittest
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage

from backend.langgraph.chat_agent import run_chat
from backend.services.conversation_manager import conversation_manager


class _ToolModel:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.bound = []

    def bind_tools(self, tools):
        self.bound = [tool.name if hasattr(tool, "name") else tool.get("type") for tool in tools]
        return self

    async def ainvoke(self, _messages):
        return next(self.responses)


def tool_call(name, args, call_id="call-1"):
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}])


class AtlasChatToolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.session = conversation_manager.create_session("tool-test-session")
        self.session.user_location = (-122.3321, 47.6062)

    async def asyncTearDown(self):
        conversation_manager.delete_session("tool-test-session")

    async def test_nearby_search_returns_map_presentation_and_route(self):
        model = _ToolModel([
            tool_call("find_nearby_places", {"query": "gas stations", "limit": 2}),
            AIMessage(content="I found two nearby gas stations on the map."),
        ])
        places = [[{
            "name": "North Fuel",
            "latitude": 47.61,
            "longitude": -122.33,
            "full_address": "1 Pine St",
            "category": "Gas Station",
        }], [{
            "name": "South Fuel",
            "latitude": 47.60,
            "longitude": -122.34,
            "full_address": "2 Oak St",
            "category": "Gas Station",
        }]]
        with (
            patch("backend.langgraph.chat_agent.get_chat_model", return_value=model),
            patch("backend.services.place_search_service.suggest", new=AsyncMock(return_value=[{"external_id": "a"}, {"external_id": "b"}])),
            patch("backend.services.place_search_service.retrieve", new=AsyncMock(side_effect=places)),
            patch("backend.langgraph.chat_agent._road_route", new=AsyncMock(return_value={"route": {"type": "Feature"}})),
            patch("backend.services.conversation_manager.conversation_manager.save_conversation", new=AsyncMock()),
        ):
            result = await run_chat("tool-test-session", "Where is the nearest gas station?")

        self.assertEqual(result["tool_calls_used"], ["find_nearby_places"])
        self.assertEqual(result["presentation"]["kind"], "nearby_map")
        self.assertEqual(len(result["locations"]), 2)
        self.assertIsNone(result["pending_action"])

    async def test_nearby_search_merges_multiple_categories_into_one_map(self):
        model = _ToolModel([
            tool_call("find_nearby_places", {
                "categories": ["car washes", "gas stations"],
                "limit_per_category": 1,
            }),
            AIMessage(content="I found both car washes and gas stations nearby."),
        ])

        async def suggest(query, **_kwargs):
            return [{"external_id": query}]

        async def retrieve(external_id, _session_token):
            if external_id == "car washes":
                return [{
                    "name": "Shine Car Wash", "latitude": 47.607, "longitude": -122.333,
                    "full_address": "1 Wash Way", "category": "Car Wash",
                }]
            return [{
                "name": "North Fuel", "latitude": 47.608, "longitude": -122.334,
                "full_address": "2 Fuel Lane", "category": "Gas Station",
            }]

        with (
            patch("backend.langgraph.chat_agent.get_chat_model", return_value=model),
            patch("backend.services.place_search_service.suggest", new=AsyncMock(side_effect=suggest)),
            patch("backend.services.place_search_service.retrieve", new=AsyncMock(side_effect=retrieve)),
            patch("backend.langgraph.chat_agent._road_route", new=AsyncMock(return_value=None)),
            patch("backend.services.conversation_manager.conversation_manager.save_conversation", new=AsyncMock()),
        ):
            result = await run_chat("tool-test-session", "Where are the nearest car washes and gas stations?")

        self.assertEqual(result["presentation"]["title"], "Nearby car washes and gas stations")
        self.assertEqual(len(result["presentation"]["places"]), 2)
        self.assertEqual([group["category"] for group in result["presentation"]["groups"]], ["car washes", "gas stations"])
        self.assertEqual({place["requested_category"] for place in result["locations"]}, {"car washes", "gas stations"})

    async def test_pasted_places_then_add_produces_confirmation_only(self):
        extracted = [{
            "name": "Museum One", "latitude": 47.61, "longitude": -122.33,
            "full_address": "1 Pine St", "category": "Museum",
        }]
        model = _ToolModel([
            tool_call("extract_pasted_places", {"text": "Museum One, Seattle"}),
            tool_call("propose_add_places", {"places": extracted}, "call-2"),
            AIMessage(content="I prepared these places for your confirmation."),
        ])
        with (
            patch("backend.langgraph.chat_agent.get_chat_model", return_value=model),
            patch("backend.services.smart_text_service.analyze_smart_text", new=AsyncMock(return_value={"title": "Paste", "locations": extracted, "route": None})),
            patch("backend.services.conversation_manager.conversation_manager.save_conversation", new=AsyncMock()),
        ):
            result = await run_chat("tool-test-session", "Add these places from my pasted text.")

        self.assertEqual(result["tool_calls_used"], ["extract_pasted_places", "propose_add_places"])
        self.assertEqual(result["pending_action"]["kind"], "save_places")
        self.assertEqual(result["pending_action"]["places"][0]["name"], "Museum One")

    async def test_create_atlas_is_a_draft_until_confirmed(self):
        places = [{
            "name": "Stop One", "latitude": 47.61, "longitude": -122.33,
            "full_address": "1 Pine St", "category": "Cafe",
        }]
        model = _ToolModel([
            tool_call("propose_create_atlas", {"title": "Seattle Saturday", "places": places}),
            AIMessage(content="This Atlas is ready for your review."),
        ])
        with (
            patch("backend.langgraph.chat_agent.get_chat_model", return_value=model),
            patch("backend.services.conversation_manager.conversation_manager.save_conversation", new=AsyncMock()),
        ):
            result = await run_chat("tool-test-session", "Create an Atlas called Seattle Saturday.")

        self.assertEqual(result["pending_action"]["kind"], "create_atlas")
        self.assertEqual(result["presentation"]["kind"], "atlas_draft")
        self.assertEqual(self.session.pending_chat_action["action_id"], result["pending_action"]["action_id"])


if __name__ == "__main__":
    unittest.main()
