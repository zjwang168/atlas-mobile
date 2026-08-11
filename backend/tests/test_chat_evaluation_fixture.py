import json
import unittest
from pathlib import Path


class ChatEvaluationFixtureTests(unittest.TestCase):
    def test_has_fifteen_long_tool_scenarios(self):
        path = Path(__file__).parents[1] / "evaluations" / "chat_long_dialogue_cases.json"
        cases = json.loads(path.read_text())
        self.assertEqual(len(cases), 15)
        self.assertTrue(all(len(case["turns"]) >= 6 for case in cases))
        self.assertTrue(all(case["expected_tools"] for case in cases))


if __name__ == "__main__":
    unittest.main()
