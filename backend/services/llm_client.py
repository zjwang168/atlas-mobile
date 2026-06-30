"""DeepSeek V4 Flash LLM client with tool calling support.

Core LLM client that supports two modes:
1. Tool calling (when `tools` parameter is provided)
2. Plain text completion (backward compatible)

Uses the DeepSeek Chat API (compatible with OpenAI SDK format).
"""

import json
import os
import time
from typing import Optional

import httpx

DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"
DEFAULT_MODEL = "deepseek-chat"

# Retrieve API key from environment (not hardcoded in source)
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")

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
        # Not JSON — treat as plain text response
        return {
            "type": "text",
            "content": cleaned,
            "tool_calls": None,
        }


def call_llm(
    messages: list[dict],
    tools: Optional[list[dict]] = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    api_key: Optional[str] = None,
    model: str = DEFAULT_MODEL,
    max_retries: int = 2,
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
    key = api_key or API_KEY
    if not key:
        raise ValueError(
            "DeepSeek API key is missing. "
            "Set DEEPSEEK_API_KEY environment variable."
        )

    # Build messages with optional tool definitions appended to system prompt
    if tools:
        tools_prompt = _build_tools_prompt(tools)
        enriched_messages = []
        for msg in messages:
            if msg["role"] == "system":
                enriched_messages.append({
                    "role": "system",
                    "content": msg["content"] + tools_prompt,
                })
            else:
                enriched_messages.append(msg)
    else:
        enriched_messages = messages

    payload = {
        "model": model,
        "messages": enriched_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    last_error = None

    for attempt in range(1 + max_retries):
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    DEEPSEEK_API_URL, json=payload, headers=headers
                )
                response.raise_for_status()
                data = response.json()

            try:
                content = data["choices"][0]["message"]["content"]
            except (KeyError, IndexError) as exc:
                raise ValueError(
                    "Unexpected DeepSeek API response structure"
                ) from exc

            # Parse and return the response
            return parse_llm_response(content)

        except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < max_retries:
                time.sleep(1.0 * (attempt + 1))  # Exponential-ish backoff
                continue

    raise ValueError(
        f"LLM call failed after {max_retries + 1} attempts. "
        f"Last error: {last_error}"
    )


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
