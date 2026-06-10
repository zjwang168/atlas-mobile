"""Reddit post content fetcher via the official JSON API (primary) 
and HTML scraping (fallback).

The JSON API endpoint is free and requires no authentication for public posts.
If blocked, falls back to parsing the HTML version from old.reddit.com.
"""

import re
from typing import Optional

import httpx
from bs4 import BeautifulSoup

REDDIT_JSON_URL = "https://www.reddit.com/r/{subreddit}/comments/{post_id}/.json"
REDDIT_HTML_URL = "https://old.reddit.com/r/{subreddit}/comments/{post_id}/"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def _extract_post_id(url: str) -> Optional[tuple[str, str]]:
    """Extract (subreddit, post_id) from a Reddit URL."""
    patterns = [
        r"(?:www\.)?reddit\.com/r/(\w+)/comments/(\w+)",
    ]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1), m.group(2)
    return None


def _try_json_api(subreddit: str, post_id: str) -> Optional[dict]:
    """Try fetching via the Reddit JSON API.

    Returns parsed dict or None if blocked/failed.
    """
    api_url = REDDIT_JSON_URL.format(subreddit=subreddit, post_id=post_id)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            response = client.get(api_url, headers=headers)
            if response.status_code == 403 or response.status_code >= 400:
                return None
            response.raise_for_status()
            data = response.json()
            post_data = data[0]["data"]["children"][0]["data"]
            return {
                "title": post_data.get("title", ""),
                "selftext": post_data.get("selftext", ""),
                "url": post_data.get("url", ""),
                "subreddit": subreddit,
            }
    except (httpx.HTTPError, (KeyError, IndexError, TypeError)):
        return None


def _scrape_html(subreddit: str, post_id: str) -> dict:
    """Fallback: scrape the post from old.reddit.com.

    Uses HTTP/1.1 with full browser headers to avoid WAF blocks.
    Extracts title and post body via BeautifulSoup.
    """
    html_url = REDDIT_HTML_URL.format(subreddit=subreddit, post_id=post_id)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
    }
    # HTTP/1.1 is required — Reddit's WAF blocks HTTP/2 requests from non-browsers
    with httpx.Client(http2=False, timeout=15.0, follow_redirects=True) as client:
        response = client.get(html_url, headers=headers)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "lxml")

    # Extract title from the post's title link
    title = ""
    title_elem = soup.find("a", class_="title")
    if title_elem:
        title = title_elem.get_text(strip=True)
    if not title:
        # Fallback: look for any h1
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text(strip=True)

    # Extract post body from the post's usertext div
    selftext_parts = []
    # Find the post's own usertext-body (not comments)
    post_div = soup.find("div", id=lambda x: x and x.startswith("siteTable"))
    if post_div:
        body_div = post_div.find("div", class_="usertext-body")
        if body_div:
            md_div = body_div.find("div", class_="md")
            if md_div:
                selftext_parts.append(md_div.get_text("\n", strip=True))
    else:
        # Fallback: find first usertext-body
        body_div = soup.find("div", class_="usertext-body")
        if body_div:
            md_div = body_div.find("div", class_="md")
            if md_div:
                selftext_parts.append(md_div.get_text("\n", strip=True))

    # Also extract comments (top-level) — this is where locations are listed
    comment_divs = soup.find_all("div", class_="entry")
    comments = []
    for entry in comment_divs:
        # Skip the post itself (it has a different structure)
        usertext = entry.find("div", class_="usertext-body")
        if usertext:
            md = usertext.find("div", class_="md")
            if md:
                text = md.get_text("\n", strip=True)
                if text and len(text) > 20:  # Skip very short comments
                    comments.append(text)

    # Combine post body + top 30 comments for LLM processing
    all_text = "\n\n".join(selftext_parts)
    if comments:
        comment_text = "\n\n---\n\nTop comments:\n\n" + "\n\n".join(comments[:30])
        all_text += comment_text

    return {
        "title": title,
        "selftext": all_text,
        "url": html_url,
        "subreddit": subreddit,
    }


def fetch_reddit_post(url: str) -> dict:
    """Fetch a Reddit post. Tries JSON API first, then falls back to HTML scraping.

    Returns:
        dict with keys: title, selftext, url, subreddit

    Raises:
        ValueError: if the URL is not a valid Reddit post URL.
        httpx.HTTPError: if both fetch methods fail.
    """
    parsed = _extract_post_id(url)
    if parsed is None:
        raise ValueError(f"Could not extract Reddit post ID from URL: {url}")

    subreddit, post_id = parsed

    # Try JSON API first
    result = _try_json_api(subreddit, post_id)
    if result is not None:
        return result

    # Fallback to HTML scraping
    return _scrape_html(subreddit, post_id)
