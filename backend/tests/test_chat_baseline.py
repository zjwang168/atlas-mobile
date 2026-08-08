import unittest
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from backend.langgraph.chat_agent import run_chat
from backend.services.conversation_manager import conversation_manager


class _FakeChatModel:
    def __init__(self):
        self.calls = []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        return AIMessage(content="A plain answer from the model.")


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
        with patch("backend.langgraph.chat_agent.get_chat_model", return_value=model), \
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
        save.assert_awaited_once()

    async def test_chat_does_not_run_memory_maintenance(self):
        model = _FakeChatModel()
        with patch("backend.langgraph.chat_agent.get_chat_model", return_value=model), \
             patch.object(conversation_manager, "save_conversation", new=AsyncMock(return_value="conversation-id")), \
             patch.object(conversation_manager, "get_all_memories", new=AsyncMock(side_effect=AssertionError("memory must not be read"))):
            await run_chat("baseline-test-session", "Answer normally.")

        self.assertEqual(len(model.calls), 1)


if __name__ == "__main__":
    unittest.main()
