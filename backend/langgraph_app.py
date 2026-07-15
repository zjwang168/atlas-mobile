"""LangGraph app entrypoint for LangGraph Studio.

This module exposes the existing Atlas parse graph in a Studio-friendly form
without changing the FastAPI compatibility layer.
"""

from __future__ import annotations

from backend.langgraph.atlas_graph import app
