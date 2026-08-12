"""Web-content entry point used by the URL import graph."""

import asyncio
from contextlib import suppress

from backend.services.reddit_fetcher import fetch_reddit_json_post, fetch_reddit_legacy_post
from backend.services.universal_web_content import scrape_universal_web_content


def _looks_like_reddit(url: str) -> bool:
    return any(host in url.lower() for host in ("reddit.com/", "redd.it/"))


class WebScraper:
    """Scrapes content from various web sources."""

    @staticmethod
    async def scrape(url: str) -> dict:
        # JSON has the best comment recall. Only after JSON fails do we race the
        # old.reddit HTML fallback against the generic reader, so a blocked
        # legacy page cannot delay the generic path behind a login redirect.
        if _looks_like_reddit(url):
            try:
                post = await asyncio.to_thread(fetch_reddit_json_post, url)
                return _reddit_result(post, url, "reddit_json")
            except Exception:
                pass

            legacy_task = asyncio.create_task(asyncio.to_thread(fetch_reddit_legacy_post, url))
            universal_task = asyncio.create_task(scrape_universal_web_content(url, force_browser=True))
            parent_task = asyncio.current_task()
            if parent_task:
                # A cancelled parse must also release the speculative Reddit
                # and browser tasks started by this race.
                parent_task.add_done_callback(
                    lambda _task: [child.cancel() for child in (legacy_task, universal_task) if not child.done()]
                )
            done, pending = await asyncio.wait(
                {legacy_task, universal_task},
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Prefer a valid old.reddit result if it wins the race. Otherwise
            # return the generic reader as soon as it has usable content.
            for task in done:
                try:
                    result = task.result()
                    if task is legacy_task and _is_usable_reddit_post(result):
                        universal_task.cancel()
                        with suppress(asyncio.CancelledError):
                            await universal_task
                        return _reddit_result(result, url, "reddit_html")
                    if task is universal_task and result.get("success"):
                        legacy_task.cancel()
                        return result
                except Exception:
                    continue

            # The first task failed or returned an empty page; await the other
            # path before reporting the source as unavailable.
            for task in pending:
                try:
                    result = await task
                    if task is legacy_task and _is_usable_reddit_post(result):
                        return _reddit_result(result, url, "reddit_html")
                    if task is universal_task:
                        return result
                except Exception:
                    continue
            return {
                "title": "",
                "content": "",
                "source_type": "reddit",
                "url": url,
                "success": False,
                "error": "Reddit did not expose readable post content.",
                "provider": None,
            }
        return await scrape_universal_web_content(url)


def _reddit_result(post: dict, url: str, provider: str) -> dict:
    title = post.get("title", "")
    content = f"{title}\n\n{post.get('selftext', '')}".strip()
    if not content:
        raise ValueError("Reddit page did not expose readable content")
    return {
        "title": title,
        "content": content,
        "source_type": "reddit",
        "url": url,
        "success": True,
        "error": None,
        "provider": provider,
    }


def _is_usable_reddit_post(post: dict) -> bool:
    """Reject old.reddit login/interstitial pages before they win the race."""
    title = (post.get("title") or "").strip()
    content = (post.get("selftext") or "").strip()
    blocked_markers = ("log in", "sign in", "reddit - the heart of the internet")
    return bool(title and content and not any(marker in title.lower() for marker in blocked_markers))
