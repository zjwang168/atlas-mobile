"""Web-content entry point used by the URL import graph."""

import asyncio

from backend.services.reddit_fetcher import fetch_reddit_post
from backend.services.universal_web_content import scrape_universal_web_content


def _looks_like_reddit(url: str) -> bool:
    return any(host in url.lower() for host in ("reddit.com/", "redd.it/"))


class WebScraper:
    """Scrapes content from various web sources."""

    @staticmethod
    async def scrape(url: str) -> dict:
        # Reddit's JSON endpoint remains more reliable and less expensive than
        # rendering a post page. All other links use the Universal Web Agent.
        if _looks_like_reddit(url):
            try:
                post = await asyncio.to_thread(fetch_reddit_post, url)
                title = post.get("title", "")
                content = f"{title}\n\n{post.get('selftext', '')}".strip()
                if content:
                    return {
                        "title": title,
                        "content": content,
                        "source_type": "reddit",
                        "url": url,
                        "success": True,
                        "error": None,
                        "provider": "reddit_json",
                    }
            except Exception:
                pass
        return await scrape_universal_web_content(url)
