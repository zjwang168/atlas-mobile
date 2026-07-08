"""Web scraper using Playwright for JavaScript-rendered pages.

Playwright can handle SPAs, dynamic content, and pages that require JavaScript
execution — unlike simple HTTP-based scrapers (trafilatura/httpx).

Usage:
    pip install playwright
    playwright install chromium
"""

import asyncio
import os
from typing import Optional

from playwright.async_api import async_playwright


async def scrape_url(url: str, timeout_ms: int = 30000) -> dict:
    """Navigate to a URL using Playwright and extract page content.

    Handles JavaScript-rendered pages, SPAs, and dynamic content.

    Args:
        url: The URL to scrape.
        timeout_ms: Navigation timeout in milliseconds.

    Returns:
        {
            "title": str,
            "content": str,       # Main text content
            "url": str,
            "success": bool,
            "error": str | None
        }
    """
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 720},
                locale="en-US",
            )
            page = await context.new_page()

            # Navigate and wait for network idle
            await page.goto(url, wait_until="networkidle", timeout=timeout_ms)

            # Wait a bit for any lazy-loaded content
            await asyncio.sleep(2)

            # Get the page title
            title = await page.title()

            # Extract text content — remove script/style elements
            content = await page.evaluate("""
                () => {
                    // Clone body to avoid modifying the live page
                    const clone = document.body.cloneNode(true);
                    // Remove unwanted elements
                    const removals = clone.querySelectorAll(
                        'script, style, nav, footer, header, iframe, svg, ' +
                        'noscript, meta, link'
                    );
                    removals.forEach(el => el.remove());
                    // Get text
                    return clone.innerText || '';
                }
            """)

            # Clean up
            await browser.close()

            if not content or len(content.strip()) < 50:
                return {
                    "title": title,
                    "content": "",
                    "url": url,
                    "success": False,
                    "error": "Page content too short or empty",
                }

            # Truncate to reasonable length
            lines = [l.strip() for l in content.split("\n") if l.strip()]
            truncated = "\n".join(lines[:300])

            print(f"[Playwright] Scraped '{url}' — {len(truncated)} chars, title='{title[:60]}'")
            return {
                "title": title,
                "content": truncated,
                "url": url,
                "success": True,
                "error": None,
            }

    except Exception as e:
        print(f"[Playwright] Failed to scrape '{url}': {e}")
        return {
            "title": "",
            "content": "",
            "url": url,
            "success": False,
            "error": str(e),
        }


async def scrape_and_classify(url: str) -> dict:
    """Scrape a URL and classify the content for pipeline routing.

    Returns a dict compatible with the image_scanner output format:
    {"classification": "named_poi" | "address", "text": str, ...}
    """
    import json

    from backend.services.llm_client import call_llm, parse_llm_response

    result = await scrape_url(url)
    if not result["success"] or not result["content"]:
        raise ValueError(
            f"Failed to scrape URL: {result.get('error', 'No content extracted')}"
        )

    text = result["content"]
    title = result["title"]

    # Classify the scraped content using LLM (same logic as image_scanner)
    CLASSIFY_PROMPT = """You are a text classifier for a travel app. Given webpage content, determine the nature of the content.

Classify as one of:
- "named_poi": The content contains clear landmark names, place names, POI names, attraction names,
  restaurant names, or other specific venues that people would search for by name.
  Examples: "The Bund", "Shanghai Tower", "Joe's Pizza", "Golden Gate Bridge"

- "address": The content contains precise street addresses, mailing addresses, or location descriptions
  that are NOT specific venue names. This includes address fragments, street names with numbers,
  or descriptions like "123 Main St, Springfield" or "corner of 5th and Broadway".

Output ONLY valid JSON:
{{"classification": "named_poi" | "address", "reasoning": "brief explanation"}}

Webpage content:
{text}

JSON:"""

    llm_result = await asyncio.to_thread(
        call_llm,
        messages=[
            {
                "role": "system",
                "content": CLASSIFY_PROMPT.format(text=text[:4000]),
            },
        ],
        temperature=0.1,
        max_tokens=200,
    )

    content = llm_result.get("content", "{}")
    normalized = parse_llm_response(content)
    try:
        parsed = json.loads(normalized.get("content", "{}"))
        classification = parsed.get("classification", "named_poi")
        print(f"[Playwright] Classification: {classification} — {parsed.get('reasoning', '')}")
    except (json.JSONDecodeError, KeyError):
        classification = "named_poi"
        print(f"[Playwright] Classification failed, defaulting to 'named_poi'")

    return {
        "classification": classification,
        "text": text,
        "title": title,
        "url": url,
    }
