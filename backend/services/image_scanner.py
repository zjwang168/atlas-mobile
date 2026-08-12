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
from backend.services.translation import translate_to_english


async def scan_images(images: list[bytes], request_id: str | None = None) -> dict:
    """Full image scan pipeline: OCR → classify → route → return results.

    Args:
        images: List of raw image bytes (max 3).

    Returns:
        Dictionary with same structure as parse_link/parse_text results.
        Contains "title", "locations", "route", "source_type", etc.
    """
    from backend.services import progress

    progress.stream_note(request_id, "image:ocr", {"stage": "started"})
    # Step 1: OCR
    ocr_text = await ocr_images(images)
    progress.stream_note(request_id, "image:ocr", {"stage": "completed"})
    return await scan_text(ocr_text, request_id=request_id)


async def scan_text(text: str, request_id: str | None = None) -> dict:
    """Scan OCR or pasted text through the same routing logic."""
    if not text or not text.strip():
        raise ValueError("No Place Information that can be extracted")

    print(f"[ImageScanner] OCR complete: {len(text)} chars extracted")
    from backend.services import progress
    progress.stream_note(request_id, "image:ocr", {"stage": "text_ready"})

    text = await translate_to_english(text, request_id=request_id)

    progress.stream_note(request_id, "image:classify", {"stage": "started"})
    classification = await _classify_text(text)
    print(f"[ImageScanner] Classification: {classification}")
    progress.stream_note(request_id, "image:classify", {"stage": "completed"})

    if classification == "named_poi":
        return await _route_to_extraction(text, request_id=request_id)
    return await _route_to_discovery(text, request_id=request_id)


async def _classify_text(text: str) -> str:
    """Use LLM to classify whether the OCR text has named POIs or just addresses."""
    mode = await classify_location_content(text[:4000], source_type="image_scan")
    return "named_poi" if mode == "named_poi" else "address"


async def _route_to_extraction(text: str, request_id: str | None = None) -> dict:
    """Route to the extraction pipeline (same as Reddit/URL parsing).

    This handles texts with clear POI/landmark names.
    """
    from backend.services.agent_orchestrator import AgentOrchestrator
    from backend.services.conversation_manager import conversation_manager

    session = conversation_manager.create_session()
    session.source_type = "image_scan"
    session.title = "Scanned places from image"

    orchestrator = AgentOrchestrator()
    result = await orchestrator.run_pipeline_from_text(text, session, request_id=request_id)
    result["source_type"] = "image_scan"
    return result


async def _route_to_discovery(text: str, request_id: str | None = None) -> dict:
    """Route to the atlas_discovery pipeline.

    This handles texts with precise addresses that need geocoding.
    """
    from backend.services.atlas_ai_discovery import discover_places_from_query

    # Use the OCR text as a discovery query
    result = await discover_places_from_query(text, request_id=request_id)
    result["source_type"] = "image_scan"
    return result
