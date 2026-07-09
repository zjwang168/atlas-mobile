"""Image scan service: OCR → classify → route to extraction/discovery pipeline.

Flow:
1. GLM-OCR extracts text from images
2. LLM classifies the text as either:
   - "named_poi": Has clear landmark/POI names → extraction pipeline
   - "address": Only precise addresses → atlas_discovery pipeline
3. Route to the appropriate pipeline
4. Return parsed results
"""

from backend.services.content_classifier import classify_location_content
from backend.services.glm_ocr import ocr_images


async def scan_images(images: list[bytes]) -> dict:
    """Full image scan pipeline: OCR → classify → route → return results.

    Args:
        images: List of raw image bytes (max 3).

    Returns:
        Dictionary with same structure as parse_link/parse_text results.
        Contains "title", "locations", "route", "source_type", etc.
    """
    # Step 1: OCR
    ocr_text = await ocr_images(images)
    return await scan_text(ocr_text)


async def scan_text(text: str) -> dict:
    """Scan OCR or pasted text through the same routing logic."""
    if not text or not text.strip():
        raise ValueError("No Place Information that can be extracted")

    print(f"[ImageScanner] OCR complete: {len(text)} chars extracted")

    classification = await _classify_text(text)
    print(f"[ImageScanner] Classification: {classification}")

    if classification == "named_poi":
        return await _route_to_extraction(text)
    return await _route_to_discovery(text)


async def _classify_text(text: str) -> str:
    """Use LLM to classify whether the OCR text has named POIs or just addresses."""
    mode = await classify_location_content(text[:4000], source_type="image_scan")
    return "named_poi" if mode == "named_poi" else "address"


async def _route_to_extraction(text: str) -> dict:
    """Route to the extraction pipeline (same as Reddit/URL parsing).

    This handles texts with clear POI/landmark names.
    """
    from backend.services.agent_orchestrator import AgentOrchestrator
    from backend.services.conversation_manager import conversation_manager

    session = conversation_manager.create_session()
    session.source_type = "image_scan"
    session.title = "Scanned places from image"

    orchestrator = AgentOrchestrator()
    result = await orchestrator.run_pipeline_from_text(text, session)
    result["source_type"] = "image_scan"
    return result


async def _route_to_discovery(text: str) -> dict:
    """Route to the atlas_discovery pipeline.

    This handles texts with precise addresses that need geocoding.
    """
    from backend.services.atlas_ai_discovery import discover_places_from_query

    # Use the OCR text as a discovery query
    result = await discover_places_from_query(text)
    result["source_type"] = "image_scan"
    return result
