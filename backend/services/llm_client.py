"""DeepSeek V4 Flash LLM client with tool calling support.

Core LLM client that supports two modes:
1. Tool calling (when `tools` parameter is provided)
2. Plain text completion (backward compatible)

Uses the DeepSeek Chat API (compatible with OpenAI SDK format).
"""

import logging
import os
import time
from typing import Optional

import json
import re

from langchain_core.messages import AIMessage

from backend.langchain.runtime import ProgressStreamHandler, get_chat_model, normalize_messages

logger = logging.getLogger("atlas.llm")

DEFAULT_MODEL = "deepseek-chat"
HUNYUAN_DEFAULT_MODEL = os.environ.get("HUNYUAN_MODEL", "hy3-preview")
HUNYUAN_REASONING_EFFORT = os.environ.get("HUNYUAN_REASONING_EFFORT", "low").strip() or "low"
HUNYUAN_WEB_PROMPT = """You are using Tencent Hunyuan in live-web mode.

Rules:
1. Prefer up-to-date, web-backed information over static model memory.
2. If the task involves facts about current events, people, places, venues,
   events, weddings, openings, closures, or other changeable real-world facts,
   use live web search / enhancement to verify the answer.
3. Do not answer from memory when live verification is available.
4. If you cannot verify something from the web, say so clearly instead of guessing.
"""
QWEN_DEFAULT_MODEL = os.environ.get("QWEN_MODEL", "qwen3.5-flash")
QWEN_WEB_PROMPT = """You are using Qwen in live-web mode.

Rules:
1. Prefer up-to-date, web-backed information over static model memory.
2. If the task involves facts about current events, people, places, venues,
   events, weddings, openings, closures, or other changeable real-world facts,
   use live web search to verify the answer.
3. Do not answer from memory when live verification is available.
4. If you cannot verify something from the web, say so clearly instead of guessing.
5. Prefer the newest and most recent sources. If multiple sources disagree,
   trust the most recent sources over older ones.
6. When the task depends on a real-world factual claim, consult multiple
   distinct sources rather than relying on a single result.
"""

# Module-level variable to expose the most recent LLM call's token usage.
# Useful when the LLM call is wrapped inside another function (e.g. ExtractionPipeline)
# and the caller cannot access the return value directly.
_last_llm_usage: dict = {"input_tokens": 0, "output_tokens": 0, "duration_s": 0.0}

_LOG_TRUNCATE_CHARS = 4000


def get_last_llm_usage() -> dict:
    """Return the token usage of the most recent call_llm() invocation.

    Returns:
        dict with keys: input_tokens, output_tokens, duration_s
    """
    return dict(_last_llm_usage)

SYSTEM_PROMPT = """You are a location extraction assistant. Extract all real geographic locations (cities, landmarks, restaurants, shops, parks, natural features) from the Reddit post text below.

Rules:
1. Output ONLY a JSON object with this exact structure:
   {"locations": ["name1", "name2", ...], "removed_noise": ["explanation1", ...] | null}
2. Include only actual geographic places that people can visit.
3. If multiple locations are mentioned, infer the main region from context.
4. Remove "noise addresses" that are far from the main region.
   - Example: post about San Francisco → remove addresses in New York.
   - Example: post about a 7-day Europe trip → remove non-European addresses.
   - Example: post about Jiang-Zhe-Hu region → remove addresses outside it.
5. If you removed any noise addresses, list them in "removed_noise" with brief explanations.
6. If no noise was removed, set "removed_noise" to null.
7. For ambiguous names (e.g. "Chaoyang"), include clarifying context like city/region.
8. Each location name should be specific enough for geocoding (e.g. "Golden Gate Bridge, San Francisco" not just "Golden Gate Bridge")."""


def _build_tools_prompt(tools: list[dict]) -> str:
    """Build tool definitions section for system prompt.

    Args:
        tools: List of tool schemas with keys: name, description, parameters.

    Returns:
        Formatted string describing available tools and their usage.
    """
    
    parts = ["\n\nYou have access to the following tools:"]
    for t in tools:
        parts.append(f"\n### {t['name']}")
        parts.append(t['description'])
        parts.append(f"Parameters: {json.dumps(t['parameters'], indent=2)}")
    parts.append("\n\nWhen you need to use a tool, respond with JSON:")
    parts.append('{"type": "tool_call", "tool": "tool_name", "arguments": {...}}')
    parts.append('When you have the final answer, respond with:')
    parts.append('{"type": "final_answer", "content": "..."}')
    return "\n".join(parts)


def _truncate_for_log(value: str, limit: int = _LOG_TRUNCATE_CHARS) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + f"... <truncated {len(value) - limit} chars>"


def _serialize_messages_for_log(messages: list[dict]) -> str:
    sanitized = []
    for msg in messages:
        sanitized.append(
            {
                "role": msg.get("role"),
                "content": _truncate_for_log(str(msg.get("content", ""))),
            }
        )
    return json.dumps(sanitized, ensure_ascii=False)


def _serialize_extra_body_for_log(extra_body: Optional[dict]) -> str:
    if not extra_body:
        return "{}"
    safe = dict(extra_body)
    return json.dumps(safe, ensure_ascii=False)


def parse_llm_response(response_text: str) -> dict:
    """Parse LLM response, handling multiple response formats.

    Handles:
    - Markdown code fences (```json ... ```)
    - Raw JSON
    - Tool calls (structured JSON with type field)
    - Text-only responses

    Args:
        response_text: Raw response string from the LLM.

    Returns:
        Normalized dict with keys:
            - type: "tool_call" | "text" | "final_answer"
            - content: str (the raw or parsed text content)
            - tool_calls: list[{"name": str, "arguments": dict}] | None
    """
    cleaned = response_text.strip()

    # Strip markdown code fences if present
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        # Remove first and last fence lines
        fence_lines = [
            line for line in lines
            if not line.startswith("```")
        ]
        cleaned = "\n".join(fence_lines).strip()

    # If the model wrapped a JSON tool call in surrounding prose, try to
    # recover the first JSON object so the agent loop can continue normally.
    if not cleaned.startswith("{") and "tool" in cleaned and "arguments" in cleaned:
        extracted = _extract_first_json_object(cleaned)
        if extracted:
            cleaned = extracted

    # Try to parse as structured JSON
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            msg_type = parsed.get("type", "text")

            if msg_type == "tool_call":
                return {
                    "type": "tool_call",
                    "content": cleaned,
                    "tool_calls": [{
                        "name": parsed.get("tool", ""),
                        "arguments": parsed.get("arguments", {}),
                    }],
                }

            if msg_type == "final_answer":
                return {
                    "type": "final_answer",
                    "content": parsed.get("content", cleaned),
                    "tool_calls": None,
                }

            # If it has a "tool" key but no explicit type, treat as tool_call
            if "tool" in parsed:
                return {
                    "type": "tool_call",
                    "content": cleaned,
                    "tool_calls": [{
                        "name": parsed["tool"],
                        "arguments": parsed.get("arguments", {}),
                    }],
                }

            # Plain JSON object — could be a regular response (like extract_locations)
            return {
                "type": "text",
                "content": cleaned,
                "tool_calls": None,
            }

        # JSON array or other non-dict JSON
        return {
            "type": "text",
            "content": cleaned,
            "tool_calls": None,
        }

    except json.JSONDecodeError:
        extracted = _extract_first_json_object(cleaned)
        if extracted and extracted != cleaned:
            try:
                parsed = json.loads(extracted)
                if isinstance(parsed, dict):
                    msg_type = parsed.get("type", "text")
                    if msg_type == "tool_call" or "tool" in parsed:
                        return {
                            "type": "tool_call",
                            "content": extracted,
                            "tool_calls": [{
                                "name": parsed.get("tool", ""),
                                "arguments": parsed.get("arguments", {}),
                            }],
                        }
                    if msg_type == "final_answer":
                        return {
                            "type": "final_answer",
                            "content": parsed.get("content", extracted),
                            "tool_calls": None,
                        }
            except Exception:
                pass
        # Not JSON — treat as plain text response
        return {
            "type": "text",
            "content": cleaned,
            "tool_calls": None,
        }


def _extract_first_json_object(text: str) -> str | None:
    """Best-effort extraction of the first JSON object from messy model output."""
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:idx + 1].strip()

    return None


def call_llm(
    messages: list[dict],
    tools: Optional[list[dict]] = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    api_key: Optional[str] = None,
    model: str = DEFAULT_MODEL,
    max_retries: int = 2,
    provider: str = "deepseek",
    extra_body: Optional[dict] = None,
    request_id: Optional[str] = None,
) -> dict:
    """Core LLM call with optional tool definitions and retry logic.

    Args:
        messages: List of {"role": "system"|"user"|"assistant", "content": str}.
        tools: Optional list of tool schemas for function calling.
        temperature: 0.0-1.0, lower = more deterministic.
        max_tokens: Maximum response tokens.
        api_key: DeepSeek API key. Falls back to DEEPSEEK_API_KEY env var.
        model: Model name to use.
        max_retries: Number of retry attempts on failure (default: 2).

    Returns:
        Normalized dict with keys:
            - type: "tool_call" | "text" | "final_answer"
            - content: str
            - tool_calls: list[{"name": str, "arguments": dict}] | None

    Raises:
        ValueError: if API key is missing or all retries fail.
        httpx.HTTPError: if the API call fails after all retries.
    """
    provider = provider.lower().strip()
    model = model or DEFAULT_MODEL

    if provider == "qwen":
        web_prompt = QWEN_WEB_PROMPT
    elif provider == "hunyuan":
        web_prompt = HUNYUAN_WEB_PROMPT
    else:
        web_prompt = ""

    enriched_messages = list(messages)
    if tools:
        tools_prompt = _build_tools_prompt(tools)
        for idx, msg in enumerate(enriched_messages):
            if msg["role"] == "system":
                enriched_messages[idx] = {
                    "role": "system",
                    "content": msg["content"] + tools_prompt,
                }
                break
        else:
            enriched_messages = [{"role": "system", "content": tools_prompt}] + enriched_messages

    if web_prompt:
        for idx, msg in enumerate(enriched_messages):
            if msg["role"] == "system":
                enriched_messages[idx] = {
                    "role": "system",
                    "content": msg["content"] + "\n\n" + web_prompt,
                }
                break
        else:
            enriched_messages = [{"role": "system", "content": web_prompt}] + enriched_messages

    logger.info(
        "LLM call input | provider=%s | model=%s | temperature=%.2f | max_tokens=%s | messages=%s | extra_body=%s",
        provider,
        model,
        temperature,
        max_tokens,
        _serialize_messages_for_log(enriched_messages),
        _serialize_extra_body_for_log(extra_body),
    )

    last_error = None
    call_start = time.time()
    stream_handler = ProgressStreamHandler(request_id, f"{provider}:{model}")

    for attempt in range(1 + max_retries):
        try:
            chat_model = get_chat_model(provider, model, temperature=temperature)
            if provider == "qwen" and extra_body:
                chat_model = chat_model.bind(**extra_body)
            if provider == "hunyuan" and extra_body:
                chat_model = chat_model.bind(**extra_body)
            response = chat_model.invoke(
                normalize_messages(enriched_messages),
                config={"callbacks": [stream_handler]},
            )
            content = response.content if isinstance(response, AIMessage) else str(response)
            duration_s = time.time() - call_start
            usage_metadata = getattr(response, "usage_metadata", {}) or {}
            usage_info = {
                "input_tokens": int(usage_metadata.get("input_tokens", 0) or 0),
                "output_tokens": int(usage_metadata.get("output_tokens", 0) or 0),
                "duration_s": round(duration_s, 3),
            }
            global _last_llm_usage
            _last_llm_usage = dict(usage_info)
            logger.info(
                "LLM call succeeded | model=%s | in=%s | out=%s | dur=%.2fs",
                model,
                usage_info["input_tokens"],
                usage_info["output_tokens"],
                duration_s,
            )
            logger.info(
                "LLM call output | provider=%s | model=%s | content=%s",
                provider,
                model,
                _truncate_for_log(str(content)),
            )
            parsed = parse_llm_response(str(content))
            parsed["usage"] = usage_info
            return parsed
        except Exception as exc:
            last_error = exc
            logger.warning(
                "LLM call failed | provider=%s | model=%s | attempt=%s/%s | error=%s",
                provider,
                model,
                attempt + 1,
                max_retries + 1,
                exc,
            )
            if attempt < max_retries:
                time.sleep(1.0 * (attempt + 1))
                continue
    raise ValueError(f"LLM call failed after {max_retries + 1} attempts. Last error: {last_error}")


def _extract_responses_output_text(data: dict) -> str:
    output = data.get("output", [])
    parts: list[str] = []
    for item in output:
        if item.get("type") != "message":
            continue
        for content_part in item.get("content", []):
            if content_part.get("type") == "output_text":
                parts.append(content_part.get("text", ""))
    if parts:
        return "".join(parts)
    return data.get("output_text", "") or data.get("text", "") or ""


def extract_locations(
    text: str,
    api_key: Optional[str] = None,
    model: str = DEFAULT_MODEL,
) -> dict:
    """Send text to DeepSeek and parse the returned JSON with locations.

    This is a backward-compatible wrapper around call_llm().

    Args:
        text: The combined title + body text of a Reddit post.
        api_key: DeepSeek API key. Falls back to DEEPSEEK_API_KEY env var.
        model: Model name to use.

    Returns:
        dict with keys: locations (list[str]), removed_noise (list[str] | None)

    Raises:
        ValueError: if API key is missing or response cannot be parsed.
        httpx.HTTPError: if the API call fails.
    """
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Text:\n{text}\n\nJSON:"},
    ]

    result = call_llm(
        messages=messages,
        tools=None,
        temperature=0.3,
        max_tokens=2048,
        api_key=api_key,
        model=model,
    )

    # Parse the text content as JSON (expected format for extract_locations)
    content = result["content"]
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Failed to parse LLM output as JSON. Content:\n{content}"
        ) from exc

    return {
        "locations": parsed.get("locations", []),
        "removed_noise": parsed.get("removed_noise"),
    }
