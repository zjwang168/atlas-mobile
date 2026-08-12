import unittest
import os
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from backend.langgraph.chat_agent import _system_prompt, generate_atlas_welcome, generate_import_welcome, run_chat, stream_chat
from backend.langchain.runtime import _base_url_for_provider
from backend.langchain.runtime import get_chat_model
from backend.services.conversation_manager import conversation_manager


class _FakeChatModel:
    def __init__(self):
        self.calls = []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        return AIMessage(content="A plain answer from the model.")


class _StreamingFakeChatModel:
    def __init__(self):
        self.calls = []

    async def astream(self, messages):
        self.calls.append(messages)
        yield AIMessage(content="A streamed ")
        yield AIMessage(content="answer.")


class ChatBaselineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.session = conversation_manager.create_session("baseline-test-session")
        self.session.title = "Coffee chat"
        self.session.locations = [{
            "name": "Blue Bottle Coffee",
            "latitude": 37.776,
            "longitude": -122.423,
            "full_address": "San Francisco, CA",
        }]
        self.session.user_memory_summary = "SECRET GLOBAL MEMORY"
        self.session.add_message("assistant", "Old answer [[PLACE_ACTION_CARD:{\"places\":[]}]]")
        self.session.add_message("assistant", "[Used tool: geocode_location]")

    async def asyncTearDown(self):
        conversation_manager.delete_session("baseline-test-session")

    async def test_one_plain_model_call_without_memory_or_tools(self):
        model = _FakeChatModel()
        with patch.dict(os.environ, {"OPENAI_MODEL_MANGO": "atlas-chat-test"}), \
             patch("backend.langgraph.chat_agent.get_chat_model", return_value=model) as get_model, \
             patch.object(conversation_manager, "save_conversation", new=AsyncMock(return_value="conversation-id")) as save:
            result = await run_chat("baseline-test-session", "Which place is attached to this chat?")

        self.assertEqual(len(model.calls), 1)
        prompt = model.calls[0]
        self.assertIsInstance(prompt[0], SystemMessage)
        self.assertIn("Blue Bottle Coffee", prompt[0].content)
        self.assertNotIn("SECRET GLOBAL MEMORY", prompt[0].content)
        self.assertTrue(all(isinstance(message, (SystemMessage, HumanMessage, AIMessage)) for message in prompt))
        self.assertFalse(any("PLACE_ACTION_CARD" in str(message.content) for message in prompt))
        self.assertFalse(any("Used tool" in str(message.content) for message in prompt))
        self.assertEqual(result["tool_calls_used"], [])
        self.assertEqual(result["place_cards"], [])
        self.assertIsNone(result["pending_action"])
        get_model.assert_called_once_with("openai_mango", "atlas-chat-test", temperature=0.3)
        save.assert_awaited_once()

    async def test_mango_chat_uses_its_own_openai_base_url(self):
        with patch.dict(os.environ, {
            "OPENAI_BASE_URL": "https://yunwu.ai/v1",
            "OPENAI_BASE_URL_MANGO": "https://api.openai.com/v1",
        }):
            self.assertEqual(_base_url_for_provider("openai_mango"), "https://api.openai.com/v1")

    async def test_mango_chat_enables_responses_web_search(self):
        with patch("langchain_openai.ChatOpenAI") as chat_openai:
            get_chat_model("openai_mango", "gpt-5.6-luna")

        kwargs = chat_openai.call_args.kwargs
        self.assertTrue(kwargs["use_responses_api"])
        self.assertEqual(kwargs["model_kwargs"], {"tools": [{"type": "web_search"}]})

    async def test_commute_prompt_only_requests_the_missing_destination_anchor(self):
        prompt = _system_prompt(self.session)

        self.assertIn("ask only for the Office/Company location", prompt)
        self.assertIn("Do not also ask for\n  Home or a separate origin", prompt)
        self.assertIn("ask only for Home when it is missing", prompt)

    async def test_chat_does_not_run_memory_maintenance(self):
        model = _FakeChatModel()
        with patch("backend.langgraph.chat_agent.get_chat_model", return_value=model), \
             patch.object(conversation_manager, "save_conversation", new=AsyncMock(return_value="conversation-id")), \
             patch.object(conversation_manager, "get_all_memories", new=AsyncMock(side_effect=AssertionError("memory must not be read"))):
            await run_chat("baseline-test-session", "Answer normally.")

        self.assertEqual(len(model.calls), 1)

    async def test_chat_streams_deltas_and_persists_the_final_answer(self):
        model = _StreamingFakeChatModel()
        with patch("backend.langgraph.chat_agent.get_chat_model", return_value=model), \
             patch.object(conversation_manager, "save_conversation", new=AsyncMock(return_value="conversation-id")) as save:
            events = [event async for event in stream_chat("baseline-test-session", "Stream this response.")]

        self.assertEqual([event["delta"] for event in events if event["type"] == "token"], ["A streamed ", "answer."])
        self.assertEqual(events[-1]["type"], "complete")
        self.assertEqual(events[-1]["response"], "A streamed answer.")
        self.assertEqual(self.session.messages[-1]["content"], "A streamed answer.")
        self.assertEqual(len(model.calls), 1)
        save.assert_awaited_once()

    async def test_import_welcome_is_assistant_first_and_maps_only_saved_selection(self):
        self.session.messages = []
        self.session.locations = [{
            "name": "Pike Place Market",
            "latitude": 47.6097,
            "longitude": -122.3425,
            "full_address": "Seattle, WA",
            "category": "Market",
        }]
        with patch("backend.langgraph.chat_agent.get_chat_model") as get_model, \
            patch.object(conversation_manager, "save_conversation", new=AsyncMock(return_value="conversation-id")) as save:
            result = await generate_import_welcome("baseline-test-session", [{
                "name": "Kerry Park",
                "latitude": 47.6295,
                "longitude": -122.3590,
            }])

        self.assertEqual(result["presentation"]["kind"], "places_map")
        self.assertEqual([place["name"] for place in result["presentation"]["places"]], ["Pike Place Market"])
        self.assertEqual([message["role"] for message in self.session.messages], ["assistant"])
        self.assertIn("1 unselected place", result["response"])
        get_model.assert_not_called()
        save.assert_awaited_once()

    async def test_atlas_welcome_keeps_ordered_orange_pin_presentation(self):
        self.session.messages = []
        self.session.title = "Seattle Saturday"
        self.session.locations = [
            {"name": "Pike Place Market", "latitude": 47.6097, "longitude": -122.3425, "timeline_day": 1, "timeline_time": "10am"},
            {"name": "Seattle Art Museum", "latitude": 47.6073, "longitude": -122.3381, "transport": "walk"},
        ]
        with patch("backend.langgraph.chat_agent.get_chat_model") as get_model, \
            patch.object(conversation_manager, "save_conversation", new=AsyncMock(return_value="conversation-id")) as save:
            result = await generate_atlas_welcome("baseline-test-session")

        self.assertEqual(result["presentation"]["kind"], "atlas_draft")
        self.assertEqual(result["presentation"]["title"], "Seattle Saturday")
        self.assertEqual([place["name"] for place in result["presentation"]["places"]], ["Pike Place Market", "Seattle Art Museum"])
        self.assertEqual([message["role"] for message in self.session.messages], ["assistant"])
        self.assertIn("Seattle Saturday", result["response"])
        get_model.assert_not_called()
        save.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
