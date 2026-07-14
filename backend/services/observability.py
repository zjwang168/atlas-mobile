"""Observability configuration for Atlas backend.

Provides LangSmith / LangChain tracing configuration so that all
LLM calls and LangGraph executions are captured in the LangSmith
dashboard for debugging, monitoring, and optimisation.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("atlas.observability")


def configure_langsmith() -> bool:
    """Configure LangSmith tracing from environment variables.

    Reads ``LANGSMITH_API_KEY`` from the environment and sets all
    required environment variables for LangChain / LangSmith tracing.

    If the key is missing the function degrades gracefully — it logs
    a warning but does **not** raise an exception so the application
    can still start without observability.

    Returns:
        ``True`` when LangSmith was successfully configured,
        ``False`` when ``LANGSMITH_API_KEY`` is absent.
    """
    api_key = (os.environ.get("LANGSMITH_API_KEY") or "").strip()
    if not api_key:
        logger.warning(
            "LANGSMITH_API_KEY not set — LangSmith tracing disabled. "
            "Set LANGSMITH_API_KEY in .env to enable observability."
        )
        return False

    # Core tracing environment variables
    os.environ["LANGSMITH_API_KEY"] = api_key
    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGSMITH_PROJECT"] = os.environ.get(
        "LANGSMITH_PROJECT", "atlas-mobile"
    )
    os.environ["LANGCHAIN_ENDPOINT"] = "https://api.smith.langchain.com"

    # Optional custom endpoint (e.g. self-hosted LangSmith instance)
    custom_endpoint = (os.environ.get("LANGSMITH_ENDPOINT") or "").strip()
    if custom_endpoint:
        os.environ["LANGSMITH_ENDPOINT"] = custom_endpoint
        logger.info("Using custom LangSmith endpoint: %s", custom_endpoint)

    logger.info(
        "LangSmith tracing enabled | project=%s | endpoint=%s",
        os.environ["LANGSMITH_PROJECT"],
        custom_endpoint or os.environ["LANGCHAIN_ENDPOINT"],
    )
    return True
