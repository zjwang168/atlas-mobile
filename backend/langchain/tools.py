"""LangChain tools used by the Atlas backend."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx


def _normalize_results(results: Any, limit: int) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in results or []:
        if not isinstance(item, dict):
            continue
        normalized.append(
            {
                "title": item.get("title") or item.get("name") or "",
                "url": item.get("url") or item.get("link") or "",
                "snippet": item.get("content") or item.get("snippet") or item.get("raw_content") or "",
            }
        )
        if len(normalized) >= limit:
            break
    return normalized


def web_search(query: str, max_results: int = 5) -> str:
    """Search the web for live, current information and return top results as JSON."""
    search_query = (query or "").strip()
    if not search_query:
        return json.dumps({"query": search_query, "results": []}, ensure_ascii=False)

    limit = max(1, min(int(max_results or 5), 10))
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        return json.dumps(
            {
                "query": search_query,
                "results": [],
                "error": "TAVILY_API_KEY not configured",
            },
            ensure_ascii=False,
        )
    try:
        response = httpx.post(
            "https://api.tavily.com/search",
            headers={"Content-Type": "application/json"},
            json={
                "api_key": api_key,
                "query": search_query,
                "max_results": limit,
                "include_answer": False,
                "include_raw_content": False,
                "include_images": False,
            },
            timeout=30.0,
        )
        response.raise_for_status()
        payload = response.json()
        results = payload.get("results") if isinstance(payload, dict) else payload
        return json.dumps(
            {
                "query": search_query,
                "results": _normalize_results(results, limit),
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps(
            {
                "query": search_query,
                "results": [],
                "error": str(exc),
            },
            ensure_ascii=False,
        )
