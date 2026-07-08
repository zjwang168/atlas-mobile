"""Multi-source web fetch chain with best-effort fallbacks.

Priority:
1. Firecrawl
2. ScrapingAnt
3. Bright Data
4. Apify
5. Webpeel
6. Existing local scrapers / browserless fallbacks
"""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass
from typing import Optional

import httpx

from backend.services.reddit_fetcher import fetch_reddit_post


@dataclass
class FetchResult:
    title: str
    content: str
    source_type: str
    url: str
    success: bool
    error: Optional[str] = None
    provider: Optional[str] = None


def _normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    return url


def _looks_like_reddit(url: str) -> bool:
    return bool(re.search(r"(reddit\.com/r/.*/comments/|redd\.it/|old\.reddit\.com/r/)", url))


def _looks_like_block_page(text: str) -> bool:
    """Detect anti-bot / captcha / interstitial pages.

    These pages often contain no usable location content and should be treated
    as failed fetches so the chain can keep falling back.
    """
    lower = (text or "").lower()
    indicators = [
        "show us your human side",
        "are you a human",
        "verify you are human",
        "captcha",
        "access denied",
        "robot",
        "bot",
        "security check",
        "unusual traffic",
        "please enable javascript",
        "cloudflare",
    ]
    return any(token in lower for token in indicators)


async def scrape_with_chain(url: str) -> dict:
    """Try multiple extractors in order, returning the first useful result."""
    url = _normalize_url(url)

    if _looks_like_reddit(url):
        try:
            post = await _scrape_reddit(url)
            if post.success:
                return post.__dict__
            last_error = post.error
        except Exception as e:
            last_error = str(e)
        else:
            last_error = "reddit scrape failed"
    else:
        last_error = None

    for provider in (
        _scrape_firecrawl,
        _scrape_scrapingant,
        _scrape_brightdata,
        _scrape_apify,
        _scrape_webpeel,
        _scrape_httpx_fallback,
    ):
        try:
            result = await provider(url)
            if result.success:
                return result.__dict__
            if result.error:
                last_error = result.error
        except Exception as e:
            last_error = str(e)
            continue

    return FetchResult(
        title="",
        content="",
        source_type="generic",
        url=url,
        success=False,
        error=last_error or "All fetchers failed",
        provider=None,
    ).__dict__


async def _scrape_reddit(url: str) -> FetchResult:
    data = await asyncio.to_thread(fetch_reddit_post, url)
    return FetchResult(
        title=data.get("title", ""),
        content=f"{data.get('title', '')}\n\n{data.get('selftext', '')}",
        source_type="reddit",
        url=url,
        success=True,
        provider="reddit_json",
    )


async def _scrape_firecrawl(url: str) -> FetchResult:
    api_key = os.getenv("FIRECRAWL_API_KEY", "").strip()
    if not api_key:
        return FetchResult("", "", "generic", url, False, "FIRECRAWL_API_KEY not configured", "firecrawl")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.firecrawl.dev/v1/scrape",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "url": url,
                    "formats": ["markdown", "html"],
                },
            )
            resp.raise_for_status()
            data = resp.json().get("data") or resp.json()
        content = data.get("markdown") or data.get("content") or ""
        title = data.get("metadata", {}).get("title") or data.get("title") or ""
        if _looks_like_block_page(f"{title}\n{content}"):
            return FetchResult(title, "", "generic", url, False, "Firecrawl returned a block/challenge page", "firecrawl")
        return FetchResult(title, content, "generic", url, bool(content), None if content else "Empty Firecrawl response", "firecrawl")
    except Exception as e:
        return FetchResult("", "", "generic", url, False, str(e), "firecrawl")


async def _scrape_scrapingant(url: str) -> FetchResult:
    api_key = os.getenv("SCRAPINGANT_API_KEY", "").strip()
    if not api_key:
        return FetchResult("", "", "generic", url, False, "SCRAPINGANT_API_KEY not configured", "scrapingant")

    try:
        endpoint = "https://api.scrapingant.com/v2/general"
        params = {"url": url, "x-api-key": api_key, "browser": "true"}
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(endpoint, params=params)
            resp.raise_for_status()
            data = resp.json()
        content = data.get("content") or data.get("html") or data.get("text") or ""
        title = data.get("title") or ""
        if _looks_like_block_page(f"{title}\n{content}"):
            return FetchResult(title, "", "generic", url, False, "ScrapingAnt returned a block/challenge page", "scrapingant")
        return FetchResult(title, content, "generic", url, bool(content), None if content else "Empty ScrapingAnt response", "scrapingant")
    except Exception as e:
        return FetchResult("", "", "generic", url, False, str(e), "scrapingant")


async def _scrape_brightdata(url: str) -> FetchResult:
    token = os.getenv("BRIGHT_DATA_API_TOKEN", "").strip()
    if not token:
        return FetchResult("", "", "generic", url, False, "BRIGHT_DATA_API_TOKEN not configured", "brightdata")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.brightdata.com/request",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"url": url},
            )
            resp.raise_for_status()
            data = resp.json()
        content = data.get("content") or data.get("html") or data.get("body") or ""
        title = data.get("title") or ""
        if _looks_like_block_page(f"{title}\n{content}"):
            return FetchResult(title, "", "generic", url, False, "Bright Data returned a block/challenge page", "brightdata")
        return FetchResult(title, content, "generic", url, bool(content), None if content else "Empty Bright Data response", "brightdata")
    except Exception as e:
        return FetchResult("", "", "generic", url, False, str(e), "brightdata")


async def _scrape_apify(url: str) -> FetchResult:
    token = os.getenv("APIFY_TOKEN", "").strip()
    if not token:
        return FetchResult("", "", "generic", url, False, "APIFY_TOKEN not configured", "apify")

    try:
        # This is intentionally generic: callers can swap in a custom actor later.
        actor_id = os.getenv("APIFY_SCRAPER_ACTOR", "apify/web-scraper")
        api_base = "https://api.apify.com/v2"
        async with httpx.AsyncClient(timeout=90.0) as client:
            run_resp = await client.post(
                f"{api_base}/acts/{actor_id}/runs",
                params={"token": token, "timeout": 300},
                json={"startUrls": [{"url": url}]},
            )
            run_resp.raise_for_status()
            run_data = run_resp.json().get("data", {})
            dataset_id = run_data.get("defaultDatasetId")
            if not dataset_id:
                return FetchResult("", "", "generic", url, False, "Apify run did not return dataset id", "apify")
            items_resp = await client.get(
                f"{api_base}/datasets/{dataset_id}/items",
                params={"token": token, "clean": "true", "format": "json"},
            )
            items_resp.raise_for_status()
            items = items_resp.json()
        if not items:
            return FetchResult("", "", "generic", url, False, "Apify dataset empty", "apify")
        first = items[0] if isinstance(items, list) else {}
        content = first.get("text") or first.get("content") or first.get("markdown") or ""
        title = first.get("title") or ""
        if _looks_like_block_page(f"{title}\n{content}"):
            return FetchResult(title, "", "generic", url, False, "Apify returned a block/challenge page", "apify")
        return FetchResult(title, content, "generic", url, bool(content), None if content else "Empty Apify response", "apify")
    except Exception as e:
        return FetchResult("", "", "generic", url, False, str(e), "apify")


async def _scrape_webpeel(url: str) -> FetchResult:
    api_key = os.getenv("WEBPEEL_API_KEY", "").strip()
    if not api_key:
        return FetchResult("", "", "generic", url, False, "WEBPEEL_API_KEY not configured", "webpeel")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.webpeel.com/v1/extract",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"url": url},
            )
            resp.raise_for_status()
            data = resp.json()
        content = data.get("content") or data.get("text") or data.get("markdown") or ""
        title = data.get("title") or ""
        if _looks_like_block_page(f"{title}\n{content}"):
            return FetchResult(title, "", "generic", url, False, "Webpeel returned a block/challenge page", "webpeel")
        return FetchResult(title, content, "generic", url, bool(content), None if content else "Empty Webpeel response", "webpeel")
    except Exception as e:
        return FetchResult("", "", "generic", url, False, str(e), "webpeel")


async def _scrape_httpx_fallback(url: str) -> FetchResult:
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        }
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()

        from bs4 import BeautifulSoup

        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        title = soup.title.get_text(strip=True) if soup.title else ""
        main = soup.find("article") or soup.find("main") or soup.find("body")
        text = main.get_text(separator="\n", strip=True) if main else ""
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        content = "\n".join(lines[:200])
        if _looks_like_block_page(f"{title}\n{content}"):
            return FetchResult(title, "", "generic", url, False, "HTTP fallback returned a block/challenge page", "httpx")
        return FetchResult(title, f"{title}\n\n{content}" if title else content, "generic", url, bool(content), None if content else "No content extracted", "httpx")
    except Exception as e:
        return FetchResult("", "", "generic", url, False, str(e), "httpx")
