"""Universal web-content extraction for the Any Links import flow.

The extractor deliberately separates fetching from travel understanding:
HTTP pages use a reader-style cleanup first; pages that only ship an app shell
fall back to a real Chromium DOM.  The resulting text includes useful image
alt text and captions so a travel article does not lose place names carried by
its photos.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from html import unescape
from typing import Optional
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup, Tag


# Editorial sites such as Conde Nast commonly embed JSON-LD, ad configuration,
# and responsive-image metadata directly in otherwise usable HTML documents.
# The cleaned article below remains capped independently before it reaches the
# travel-understanding pipeline.
MAX_HTML_BYTES = 12_000_000
MAX_ARTICLE_CHARS = 24_000
MIN_USEFUL_CHARS = 320
_SPACE_RE = re.compile(r"\s+")
_SHELL_MARKERS = ("id=\"root\"", "id='root'", "id=\"__next\"", "id='__next'", "data-reactroot")
_BLOCK_MARKERS = ("captcha", "access denied", "verify you are human", "cloudflare")
_DROP_SELECTORS = (
    "script, style, noscript, svg, iframe, form, button, nav, footer, header, "
    "aside, [role='navigation'], [role='banner'], [role='contentinfo'], "
    ".advertisement, .ads, .ad, [data-testid*='ad']"
)


@dataclass
class UniversalWebResult:
    title: str
    content: str
    source_type: str
    url: str
    success: bool
    error: Optional[str] = None
    provider: Optional[str] = None
    used_browser: bool = False

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def normalize_public_url(value: str) -> str:
    """Normalize a user URL and reject non-web schemes before fetching it."""
    value = (value or "").strip()
    if not value:
        raise ValueError("Please provide a webpage URL.")
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    parsed = urlparse(value)
    # Google search ads often copy an aclk tracking URL instead of the article
    # URL. Resolve the embedded destination locally before any network fetch.
    # This is deliberately limited to Google-owned wrapper domains; arbitrary
    # redirect parameters must not be treated as destinations.
    hostname = (parsed.hostname or "").lower()
    if hostname == "google.com" or hostname.endswith(".google.com"):
        destination = parse_qs(parsed.query).get("adurl", [""])[0].strip()
        if destination:
            value = destination
            parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only public http(s) webpage URLs can be imported.")
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded credentials cannot be imported.")
    return value


async def _assert_public_host(url: str) -> None:
    """Prevent a pasted URL from making the server fetch local/private hosts."""
    hostname = urlparse(url).hostname
    if not hostname:
        raise ValueError("The URL does not contain a hostname.")
    if hostname.lower() == "localhost" or hostname.lower().endswith(".local"):
        raise ValueError("Local-network URLs cannot be imported.")
    try:
        addresses = await asyncio.get_running_loop().run_in_executor(
            None, lambda: socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        )
    except socket.gaierror as exc:
        raise ValueError("The webpage hostname could not be resolved.") from exc
    for address in {item[4][0] for item in addresses}:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("Local-network URLs cannot be imported.")


def _clean_text(value: str) -> str:
    return _SPACE_RE.sub(" ", unescape(value or "")).strip()


def _metadata(soup: BeautifulSoup, name: str) -> str:
    tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
    return _clean_text(tag.get("content", "")) if isinstance(tag, Tag) else ""


def extract_article_from_html(html: str, fallback_title: str = "") -> tuple[str, str]:
    """Return a reader-style title and text from raw or browser-rendered HTML."""
    soup = BeautifulSoup(html or "", "lxml")
    title = _metadata(soup, "og:title") or _metadata(soup, "twitter:title")
    if not title and soup.title:
        title = _clean_text(soup.title.get_text(" ", strip=True))
    title = title or fallback_title

    for element in soup.select(_DROP_SELECTORS):
        element.decompose()

    root = soup.find("article") or soup.find("main")
    if not root:
        candidates = soup.select("[itemprop='articleBody'], .article-body, .article-content, .post-content, .entry-content")
        root = max(candidates, key=lambda node: len(node.get_text(" ", strip=True)), default=soup.body or soup)

    for image in root.find_all("img"):
        alt = _clean_text(str(image.get("alt", "")))
        if alt and len(alt) > 2:
            image.insert_after(soup.new_string(f"\nImage context: {alt}\n"))
    for caption in root.select("figcaption, [class*='caption']"):
        caption_text = _clean_text(caption.get_text(" ", strip=True))
        if caption_text:
            caption.insert_before(soup.new_string(f"\nImage caption: {caption_text}\n"))

    lines: list[str] = []
    for line in root.get_text("\n", strip=True).splitlines():
        cleaned = _clean_text(line)
        if cleaned and (not lines or lines[-1] != cleaned):
            lines.append(cleaned)
    content = "\n".join(lines)
    if title and not content.startswith(title):
        content = f"{title}\n\n{content}"
    return title, content[:MAX_ARTICLE_CHARS]


def needs_browser_render(html: str, content: str) -> bool:
    """Detect JavaScript app shells and unsuccessful reader extraction."""
    normalized_html = (html or "").lower()
    normalized_content = (content or "").lower()
    has_shell = any(marker in normalized_html for marker in _SHELL_MARKERS)
    return (
        len(content.strip()) < MIN_USEFUL_CHARS
        or (has_shell and len(content.strip()) < MIN_USEFUL_CHARS * 3)
        or any(marker in normalized_content for marker in _BLOCK_MARKERS)
    )


async def _fetch_html(url: str) -> tuple[str, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    current_url = url
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False, headers=headers) as client:
        for _ in range(5):
            await _assert_public_host(current_url)
            response = await client.get(current_url)
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise ValueError("The webpage returned an invalid redirect.")
                current_url = str(response.url.join(location))
                continue
            # Many editorial sites reject a plain HTTP client but allow a real
            # browser. Return the challenge response so the caller can select
            # the Playwright fallback instead of ending the import here.
            if response.status_code in {401, 403}:
                return str(response.url), response.text
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            if "html" not in content_type and "xhtml" not in content_type:
                raise ValueError("The URL did not return an HTML webpage.")
            if len(response.content) > MAX_HTML_BYTES:
                raise ValueError("The webpage is too large to import.")
            return str(response.url), response.text
    raise ValueError("The webpage redirected too many times.")


async def _render_html(url: str) -> tuple[str, str, str]:
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36",
                viewport={"width": 1280, "height": 900},
                locale="en-US",
            )
            try:
                page = await context.new_page()
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=5_000)
                except Exception:
                    pass
                await page.wait_for_timeout(1_000)
                return page.url, await page.title(), await page.content()
            finally:
                await context.close()
        finally:
            await browser.close()


async def scrape_universal_web_content(url: str) -> dict:
    """Fetch an arbitrary public webpage with HTTP-first and browser fallback."""
    try:
        normalized_url = normalize_public_url(url)
        final_url, html = await _fetch_html(normalized_url)
        title, content = extract_article_from_html(html, fallback_title=final_url)
        if not needs_browser_render(html, content):
            return UniversalWebResult(title, content, "universal_web", final_url, True, provider="http_reader").as_dict()

        rendered_url, browser_title, rendered_html = await _render_html(final_url)
        title, content = extract_article_from_html(rendered_html, fallback_title=browser_title or final_url)
        if len(content.strip()) < MIN_USEFUL_CHARS:
            raise ValueError("The webpage did not expose enough readable content. It may require sign-in or block automated access.")
        return UniversalWebResult(title, content, "universal_web", rendered_url, True, provider="playwright_reader", used_browser=True).as_dict()
    except Exception as exc:
        return UniversalWebResult("", "", "universal_web", url, False, str(exc), "universal_web").as_dict()
