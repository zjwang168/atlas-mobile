"""Tool definitions and registry for the Agentic LLM system.

Defines the tool schemas that are sent to the LLM as part of the prompt,
and provides a ToolRegistry class for runtime tool execution.

Each tool in TOOLS corresponds to a function that wraps an existing service.
"""

from __future__ import annotations

import json
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Tool schemas — sent to the LLM in the prompt for function calling
# ---------------------------------------------------------------------------

TOOLS: list[dict] = [
    {
        "name": "scrape_url",
        "description": (
            "Fetch and extract readable text content from any URL. "
            "Supports Reddit, travel blogs, and generic web pages."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Target URL to scrape",
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "geocode_location",
        "description": (
            "Convert a place name to geographic coordinates (latitude, longitude). "
            "Include context to disambiguate."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Place name, e.g. 'Golden Gate Bridge'",
                },
                "context": {
                    "type": "string",
                    "description": "Geographic context, e.g. 'San Francisco, California'",
                },
            },
            "required": ["name"],
        },
    },
    {
        "name": "batch_geocode",
        "description": (
            "Convert multiple place names to coordinates concurrently. "
            "Faster than calling geocode_location individually."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "locations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "context": {"type": "string"},
                        },
                        "required": ["name"],
                    },
                },
            },
            "required": ["locations"],
        },
    },
    {
        "name": "plan_route",
        "description": (
            "Calculate the shortest driving route through a set of locations "
            "using TSP (Traveling Salesman Problem) approximation."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "locations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "latitude": {"type": "number"},
                            "longitude": {"type": "number"},
                        },
                        "required": ["name", "latitude", "longitude"],
                    },
                },
                "start_index": {
                    "type": "integer",
                    "description": "Index of starting location (default: 0)",
                },
            },
            "required": ["locations"],
        },
    },
    {
        "name": "compute_region_cluster",
        "description": (
            "Cluster location names by geographic proximity to detect outliers. "
            "Returns clusters and outliers."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "location_names": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["location_names"],
        },
    },
    {
        "name": "extract_locations",
        "description": (
            "Extract geographic entities from text with hierarchical "
            "classification and noise filtering."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "Text content to extract locations from",
                },
                "source_type": {
                    "type": "string",
                    "enum": ["reddit", "travel_blog", "generic", "unknown"],
                },
            },
            "required": ["text"],
        },
    },
    {
        "name": "save_conversation",
        "description": (
            "Save the current conversation to persistent storage (Supabase) "
            "for later retrieval."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
            },
            "required": ["session_id"],
        },
    },
    {
        "name": "load_conversation",
        "description": (
            "Load a past conversation from persistent storage."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "conversation_id": {"type": "string"},
            },
            "required": ["conversation_id"],
        },
    },
    {
        "name": "map_operation",
        "description": (
            "Perform operations on map pins and route. "
            "Actions: add_pin, remove_pin, reorder_route, optimize_route."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "add_pin",
                        "remove_pin",
                        "reorder_route",
                        "optimize_route",
                    ],
                },
                "params": {
                    "type": "object",
                    "description": "Action-specific parameters",
                },
            },
            "required": ["action"],
        },
    },
]


# ---------------------------------------------------------------------------
# Tool wrapper functions — stubs that will be wired up to real services later
# ---------------------------------------------------------------------------

async def _tool_scrape_url(url: str) -> dict:
    """Fetch and extract readable content from a URL.

    Wraps the WebScraper service.
    """
    from backend.services.web_scraper import WebScraper

    result = await WebScraper.scrape(url)
    return result


async def _tool_geocode_location(name: str, context: str = "") -> dict:
    """Convert a place name to geographic coordinates.

    Wraps the geocoder service.
    """
    from backend.services.geocoder import geocode

    query = f"{name}, {context}" if context else name
    return await geocode(query)


async def _tool_batch_geocode(locations: list[dict]) -> dict:
    """Convert multiple place names to coordinates concurrently.

    Wraps the geocoder batch service.
    """
    from backend.services.geocoder import batch_geocode

    names = [
        f"{loc['name']}, {loc['context']}" if loc.get("context") else loc["name"]
        for loc in locations
    ]
    results = await batch_geocode(names)
    return {"results": results}


async def _tool_plan_route(
    locations: list[dict],
    start_index: int = 0,
) -> dict:
    """Calculate shortest driving route through a set of locations.

    Wraps the route_planner service.
    """
    from backend.services.route_planner import plan_route

    return plan_route(locations, start_index=start_index)


async def _tool_compute_region_cluster(location_names: list[str]) -> dict:
    """Cluster location names by geographic proximity.

    Stub — to be implemented.
    """
    # TODO: Implement region clustering logic
    raise NotImplementedError("compute_region_cluster not yet implemented")


async def _tool_extract_locations(text: str, source_type: str = "unknown") -> dict:
    """Extract geographic entities from text with hierarchical filtering.

    Wraps the ExtractionPipeline service.
    """
    from backend.services.extraction_pipeline import ExtractionPipeline

    result = await ExtractionPipeline.extract(text, source_type=source_type)
    return result


async def _tool_save_conversation(session_id: str) -> dict:
    """Save conversation to persistent storage.

    Wraps ConversationManager.save_conversation so the agent loop can persist
    the active session when needed.
    """
    from backend.services.conversation_manager import conversation_manager

    conversation_id = await conversation_manager.save_conversation(session_id)
    if not conversation_id:
        return {"success": False, "error": "Failed to save conversation"}
    return {"success": True, "conversation_id": conversation_id}


async def _tool_load_conversation(conversation_id: str) -> dict:
    """Load a past conversation from persistent storage.

    Wraps ConversationManager.load_conversation and returns the serialized
    session so the caller can resume from it.
    """
    from backend.services.conversation_manager import conversation_manager

    session = await conversation_manager.load_conversation(conversation_id)
    if not session:
        return {"success": False, "error": "Conversation not found"}
    return {"success": True, "session": session.to_dict()}


async def _tool_map_operation(action: str, params: dict | None = None) -> dict:
    """Perform operations on map pins and route.

    Stub — to be implemented when frontend integration is ready.
    """
    # TODO: Implement map operation logic
    raise NotImplementedError("map_operation not yet implemented")


# ---------------------------------------------------------------------------
# Map from tool name → wrapper function
# ---------------------------------------------------------------------------

_TOOL_IMPL: dict[str, Callable[..., Any]] = {
    "scrape_url": _tool_scrape_url,
    "geocode_location": _tool_geocode_location,
    "batch_geocode": _tool_batch_geocode,
    "plan_route": _tool_plan_route,
    "compute_region_cluster": _tool_compute_region_cluster,
    "extract_locations": _tool_extract_locations,
    "save_conversation": _tool_save_conversation,
    "load_conversation": _tool_load_conversation,
    "map_operation": _tool_map_operation,
}


# ---------------------------------------------------------------------------
# ToolRegistry — maps tool names to runtime implementations
# ---------------------------------------------------------------------------

class ToolRegistry:
    """Registry that maps tool names to their callable implementations.

    Supports dynamic registration and execution with error handling.
    """

    def __init__(self) -> None:
        self._tools: dict[str, Callable[..., Any]] = {}

    def register(self, name: str, func: Callable[..., Any]) -> None:
        """Register a Python function as a tool.

        Args:
            name: Tool name (must match a key in TOOLS).
            func: Async or sync callable that implements the tool.
        """
        self._tools[name] = func

    async def execute(self, name: str, args: dict[str, Any]) -> dict:
        """Execute a registered tool by name with argument validation.

        Args:
            name: Tool name to execute.
            args: Dictionary of arguments to pass to the tool function.

        Returns:
            dict with either:
                - {"success": True, "result": <tool_output>}
                - {"error": "<error message>"}
        """
        if name not in self._tools:
            return {"error": f"Unknown tool: {name}"}

        impl = self._tools[name]
        try:
            result = await impl(**args)
            return {"success": True, "result": result}
        except Exception as e:
            return {"error": str(e)}

    def get_definitions(self) -> list[dict]:
        """Return tool schemas for LLM prompt inclusion.

        Returns:
            The full TOOLS list.
        """
        return TOOLS

    def get_tool_names(self) -> list[str]:
        """Return list of registered tool names.

        Returns:
            Sorted list of registered tool names.
        """
        return sorted(self._tools.keys())


# ---------------------------------------------------------------------------
# Module-level global registry
# ---------------------------------------------------------------------------

registry = ToolRegistry()


def init_registry() -> None:
    """Initialize the global registry with all available tool implementations.

    Must be called once at application startup (e.g. in FastAPI lifespan).
    """
    for name, impl in _TOOL_IMPL.items():
        registry.register(name, impl)
