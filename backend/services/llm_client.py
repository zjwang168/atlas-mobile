"""DeepSeek V4 Flash LLM client for location extraction + noise filtering.

Uses the DeepSeek Chat API (compatible with OpenAI SDK format).
"""

import json
import os
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


def extract_locations(
    text: str,
    api_key: Optional[str] = None,
    model: str = DEFAULT_MODEL,
) -> dict:
    """Send text to DeepSeek and parse the returned JSON with locations.

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
    key = api_key or API_KEY
    if not key:
        raise ValueError(
            "DeepSeek API key is missing. "
            "Set DEEPSEEK_API_KEY environment variable."
        )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Text:\n{text}\n\nJSON:"},
        ],
        "temperature": 0.3,
        "max_tokens": 2048,
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=30.0) as client:
        response = client.post(DEEPSEEK_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        raise ValueError("Unexpected DeepSeek API response structure") from exc

    # Try to parse JSON from the response content.
    # The model might wrap it in markdown code fences.
    cleaned = content.strip()
    if cleaned.startswith("```"):
        # Remove code fences
        lines = cleaned.splitlines()
        cleaned = "\n".join(
            line for line in lines if not line.startswith("```")
        )

    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Failed to parse LLM output as JSON. Content:\n{content}"
        ) from exc

    return {
        "locations": result.get("locations", []),
        "removed_noise": result.get("removed_noise"),
    }
