"""Multi-source web scraper supporting Reddit, generic web pages, and more.

Uses trafilatura for clean text extraction with httpx fallback.
"""

import re
from typing import Optional

import httpx

from backend.services.reddit_fetcher import fetch_reddit_post


class WebScraper:
    """Scrapes content from various web sources."""

    SOURCE_PATTERNS = {
        "reddit": [
            r"reddit\.com/r/.*/comments/",
            r"redd\.it/",
            r"old\.reddit\.com/r/",
        ],
        "generic": [r".*"],  # fallback
    }

    @staticmethod
    def classify_source(url: str) -> str:
        """Classify URL by domain and path pattern."""
        for source_type, patterns in WebScraper.SOURCE_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, url):
                    return source_type
        return "generic"

    @staticmethod
    async def scrape(url: str) -> dict:
        """
        Auto-detect source type and scrape content.

        Returns:
        {
            "title": str,
            "content": str,      # Main text content
            "source_type": str,  # "reddit", "generic"
            "url": str,
            "success": bool,
            "error": str | None
        }
        """
        source_type = WebScraper.classify_source(url)

        if source_type == "reddit":
            return await WebScraper._scrape_reddit(url)
        else:
            return await WebScraper._scrape_generic(url)

    @staticmethod
    async def _scrape_reddit(url: str) -> dict:
        """Scrape Reddit post using existing reddit_fetcher."""
        try:
            import asyncio

            post = await asyncio.to_thread(fetch_reddit_post, url)
            return {
                "title": post.get("title", ""),
                "content": f"{post.get('title', '')}\n\n{post.get('selftext', '')}",
                "source_type": "reddit",
                "url": url,
                "success": True,
                "error": None,
            }
        except Exception as e:
            return {
                "title": "",
                "content": "",
                "source_type": "reddit",
                "url": url,
                "success": False,
                "error": str(e),
            }

    @staticmethod
    async def _scrape_generic(url: str) -> dict:
        """Scrape any webpage — tries trafilatura first, then httpx fallback.

        Always falls through to the httpx fallback if trafilatura fails
        (returns None, throws, or returns empty content).
        """
        import asyncio

        # Try trafilatura first
        try:
            import trafilatura

            downloaded = await asyncio.to_thread(trafilatura.fetch_url, url)
            if downloaded:
                result = await asyncio.to_thread(
                    trafilatura.extract,
                    downloaded,
                    include_comments=False,
                    include_tables=False,
                    no_fallback=False,
                )
                if result:
                    # Extract title
                    title = ""
                    try:
                        from bs4 import BeautifulSoup
                        soup = await asyncio.to_thread(BeautifulSoup, downloaded, "html.parser")
                        if soup.title:
                            title = soup.title.get_text(strip=True)
                    except Exception:
                        pass

                    return {
                        "title": title,
                        "content": result,
                        "source_type": "generic",
                        "url": url,
                        "success": True,
                        "error": None,
                    }
        except ImportError:
            pass  # trafilatura not installed
        except Exception:
            pass  # trafilatura failed — use httpx fallback

        # Fallback: httpx + BeautifulSoup with full browser headers
        return await WebScraper._scrape_generic_fallback(url)

    @staticmethod
    async def _scrape_generic_fallback(url: str) -> dict:
        """Fallback scraper using httpx + BeautifulSoup with full browser headers."""
        try:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0.0.0 Safari/537.36"
                ),
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;"
                    "q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
                ),
                "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
            }
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    url, headers=headers, follow_redirects=True, timeout=20
                )
                resp.raise_for_status()

            from bs4 import BeautifulSoup

            soup = BeautifulSoup(resp.text, "html.parser")

            # Remove script/style elements
            for tag in soup(["script", "style", "nav", "footer", "header"]):
                tag.decompose()

            title = soup.title.get_text(strip=True) if soup.title else ""
            # Get main content - prefer article or main tags
            main = soup.find("article") or soup.find("main") or soup.find("body")
            text = main.get_text(separator="\n", strip=True) if main else ""

            # Clean up: remove empty lines, truncate
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            content = "\n".join(lines[:200])  # Limit to 200 lines

            return {
                "title": title,
                "content": f"{title}\n\n{content}",
                "source_type": "generic",
                "url": url,
                "success": bool(content),
                "error": None if content else "No content extracted",
            }
        except Exception as e:
            return {
                "title": "",
                "content": "",
                "source_type": "generic",
                "url": url,
                "success": False,
                "error": str(e),
            }
