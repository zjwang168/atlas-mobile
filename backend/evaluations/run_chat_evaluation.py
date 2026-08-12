"""Run the 15-scenario Atlas chat evaluation against a configured live model.

Usage:
  python -m backend.evaluations.run_chat_evaluation --live
  python -m backend.evaluations.run_chat_evaluation --live --input-per-1m 0.15 --output-per-1m 0.60
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path
from typing import Any

from backend.langgraph.chat_agent import run_chat
from backend.services.conversation_manager import conversation_manager


CASES_PATH = Path(__file__).with_name("chat_long_dialogue_cases.json")


async def run_case(case: dict[str, Any]) -> dict[str, Any]:
    session = conversation_manager.create_session("eval-" + case["id"])
    session.user_location = tuple(case["location"])
    turn_results = []
    expected = set(case["expected_tools"])
    for turn in case["turns"]:
        started = time.perf_counter()
        result = await run_chat(session.session_id, turn)
        turn_results.append({
            "prompt": turn,
            "response": result["response"],
            "tool_calls": result["tool_calls_used"],
            "latency_ms": result["metrics"]["latency_ms"],
            "input_tokens": result["metrics"].get("input_tokens"),
            "output_tokens": result["metrics"].get("output_tokens"),
            "wall_time_ms": round((time.perf_counter() - started) * 1000),
        })
    final = turn_results[-1]
    actual = set(final["tool_calls"])
    return {
        "id": case["id"],
        "context_fact": case["context_fact"],
        "expected_tools": sorted(expected),
        "actual_tools": sorted(actual),
        "expected_tools_called": expected.issubset(actual),
        "unexpected_tools": sorted(actual - expected),
        "turns": turn_results,
        "final_response": final["response"],
    }


def summarize(results: list[dict[str, Any]], input_rate: float | None, output_rate: float | None) -> dict[str, Any]:
    final_turns = [result["turns"][-1] for result in results]
    latencies = [turn["latency_ms"] for turn in final_turns]
    inputs = sum(int(turn["input_tokens"] or 0) for turn in final_turns)
    outputs = sum(int(turn["output_tokens"] or 0) for turn in final_turns)
    unexpected = sum(len(result["unexpected_tools"]) for result in results)
    summary: dict[str, Any] = {
        "scenario_count": len(results),
        "tool_accuracy": sum(result["expected_tools_called"] for result in results) / len(results),
        "tool_misfires": unexpected,
        "mean_final_turn_latency_ms": round(sum(latencies) / len(latencies)),
        "max_final_turn_latency_ms": max(latencies),
        "input_tokens": inputs or None,
        "output_tokens": outputs or None,
        "context_accuracy_review": "Review final_response against context_fact for each scenario.",
    }
    if input_rate is not None and output_rate is not None and (inputs or outputs):
        summary["estimated_cost_usd"] = round(inputs / 1_000_000 * input_rate + outputs / 1_000_000 * output_rate, 6)
    return summary


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Call the configured model and external tools.")
    parser.add_argument("--input-per-1m", type=float)
    parser.add_argument("--output-per-1m", type=float)
    parser.add_argument("--output", type=Path, default=Path("artifacts/chat-evaluation.json"))
    args = parser.parse_args()
    cases = json.loads(CASES_PATH.read_text())
    if not args.live:
        print(json.dumps({"scenario_count": len(cases), "status": "fixture_validated", "hint": "Pass --live to run model evaluation."}, indent=2))
        return 0
    results = [await run_case(case) for case in cases]
    payload = {"summary": summarize(results, args.input_per_1m, args.output_per_1m), "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
