import unittest
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage

from backend.langgraph.chat_agent import run_chat
from backend.services.conversation_manager import conversation_manager


class _ToolModel:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.bound = []
        self.requests = []

    def bind_tools(self, tools):
        self.bound = [tool.name if hasattr(tool, "name") else tool.get("type") for tool in tools]
        return self

    async def ainvoke(self, _messages):
        self.requests.append(_messages)
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
            if external_id in {"car washes", "car wash"}:
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

    async def test_nearby_search_rejects_global_outliers_and_normalizes_dog_parks(self):
        model = _ToolModel([
            tool_call("find_nearby_places", {"query": "能遛狗的公园", "limit": 2}),
            AIMessage(content="I found a local dog park."),
        ])
        local_place = {
            "name": "Seattle Dog Park", "latitude": 47.608, "longitude": -122.335,
            "full_address": "1 Local Way", "category": "Dog Park",
        }
        remote_place = {
            "name": "Milan Dog Park", "latitude": 45.464, "longitude": 9.190,
            "full_address": "Via Privata Armando Spadini, Milan, Italy", "category": "Dog Park",
        }
        suggest = AsyncMock(return_value=[{"external_id": "local"}, {"external_id": "remote"}])
        with (
            patch("backend.langgraph.chat_agent.get_chat_model", return_value=model),
            patch("backend.services.place_search_service.suggest", new=suggest),
            patch("backend.services.place_search_service.retrieve", new=AsyncMock(side_effect=[[local_place], [remote_place]])),
            patch("backend.langgraph.chat_agent._road_route", new=AsyncMock(return_value=None)),
            patch("backend.services.conversation_manager.conversation_manager.save_conversation", new=AsyncMock()),
        ):
            result = await run_chat("tool-test-session", "我附近最近的能遛狗的公园")

        self.assertEqual([place["name"] for place in result["locations"]], ["Seattle Dog Park"])
        self.assertEqual(suggest.await_args.kwargs["query"], "dog park")
        self.assertEqual(suggest.await_args.kwargs["limit"], 6)
        self.assertIn("bbox", suggest.await_args.kwargs)

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

    async def test_create_atlas_draft_preserves_schedule_and_transport_metadata(self):
        places = [{
            "name": "Anchor Bar", "latitude": 42.937, "longitude": -78.877,
            "full_address": "1047 Main St", "category": "Restaurant",
            "timeline_day": 1, "timeline_time": "12:00 PM", "visit_duration_minutes": 60,
        }, {
            "name": "Martin House", "latitude": 42.948, "longitude": -78.851,
            "full_address": "125 Jewett Pkwy", "category": "Museum",
            "timeline_day": 1, "timeline_time": "1:30 PM", "transport": "taxi",
            "travel_duration_minutes": 15,
        }]
        model = _ToolModel([
            tool_call("propose_create_atlas", {
                "title": "Buffalo Day",
                "places": places,
                "planning_note": "Times are estimates; arrive home before 8 PM.",
            }),
            AIMessage(content="I prepared the timed Atlas draft."),
        ])
        with (
            patch("backend.langgraph.chat_agent.get_chat_model", return_value=model),
            patch("backend.services.conversation_manager.conversation_manager.save_conversation", new=AsyncMock()),
        ):
            result = await run_chat("tool-test-session", "Add times and take a taxi from Anchor Bar to Martin House.")

        martin = result["pending_action"]["places"][1]
        self.assertEqual(martin["timeline_time"], "1:30 PM")
        self.assertEqual(martin["transport"], "taxi")
        self.assertEqual(result["presentation"]["planning_note"], "Times are estimates; arrive home before 8 PM.")
        self.assertEqual([place["name"] for place in self.session.locations], ["Anchor Bar", "Martin House"])

    async def test_revised_atlas_draft_replaces_the_prior_pending_action(self):
        original_places = [{
            "name": "Anchor Bar", "latitude": 42.937, "longitude": -78.877,
            "full_address": "1047 Main St", "category": "Restaurant",
        }, {
            "name": "Martin House", "latitude": 42.948, "longitude": -78.851,
            "full_address": "125 Jewett Pkwy", "category": "Museum",
        }]
        revised_places = [
            {**original_places[0], "timeline_day": 1, "timeline_time": "12pm"},
            {**original_places[1], "timeline_day": 1, "timeline_time": "1pm", "transport": "taxi"},
        ]
        first_model = _ToolModel([
            tool_call("propose_create_atlas", {"title": "Buffalo day", "places": original_places}),
            AIMessage(content="I prepared the draft."),
        ])
        second_model = _ToolModel([
            tool_call("propose_create_atlas", {"title": "Buffalo day", "places": revised_places}),
            AIMessage(content="I updated the timed draft."),
        ])
        with (
            patch("backend.langgraph.chat_agent.get_chat_model", side_effect=[first_model, second_model]),
            patch("backend.services.conversation_manager.conversation_manager.save_conversation", new=AsyncMock()),
        ):
            initial = await run_chat("tool-test-session", "Create a Buffalo Atlas.")
            revised = await run_chat("tool-test-session", "Start at noon and take a taxi to Martin House.")

        self.assertNotEqual(initial["pending_action"]["action_id"], revised["pending_action"]["action_id"])
        self.assertEqual(revised["pending_action"]["places"][1]["transport"], "taxi")
        system_prompt = str(second_model.requests[0][0].content)
        self.assertIn("Current Atlas draft: Buffalo day", system_prompt)
        self.assertIn("(42.937, -78.877)", system_prompt)


if __name__ == "__main__":
    unittest.main()
