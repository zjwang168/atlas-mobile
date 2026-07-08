"""Gemini computer-use browser extraction for anti-bot web pages.

Strategy:
1. Open the target page in Playwright.
2. Try cheap DOM text extraction first.
3. If the page is blocked or too text-light, use Gemini Computer Use to
   interact with the browser, dismiss interstitials, and make the text readable.
4. Re-read the page DOM after each successful interaction.

Prompting goals:
- Prefer text/copy actions over screenshots whenever the page is readable.
- Avoid unrelated navigation, shopping, login prompts, and side links.
- Stop as soon as the page's main text is visible.
"""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import re
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

try:
    from google import genai
    from google.genai import types
except Exception as exc:  # pragma: no cover - import guard for local setups
    genai = None  # type: ignore[assignment]
    types = None  # type: ignore[assignment]
    _GENAI_IMPORT_ERROR = exc
from playwright.async_api import async_playwright

logger = logging.getLogger("atlas.gemini")

GEMINI_API_KEY = (
    os.environ.get("GEMINI_API_KEY", "")
    or os.environ.get("GOOGLE_API_KEY", "")
    or os.environ.get("GEMINI_API_KEY_DEV", "")
)
GEMINI_COMPUTER_USE_MODEL = os.environ.get(
    "GEMINI_COMPUTER_USE_MODEL",
    "gemini-3.5-flash",
)
COMPUTER_USE_IMAGE_SIZE = os.environ.get("GEMINI_COMPUTER_USE_IMAGE_SIZE", "512")
COMPUTER_USE_MAX_SCREENSHOTS = int(os.environ.get("GEMINI_COMPUTER_USE_MAX_SCREENSHOTS", "8"))
COMPUTER_USE_SCREENSHOT_DIR = Path(
    os.environ.get("GEMINI_COMPUTER_USE_SCREENSHOT_DIR", "atlas-computer-use-screenshots")
)
GEMINI_MIN_CALL_INTERVAL_S = float(os.environ.get("GEMINI_MIN_CALL_INTERVAL_S", "13.0"))
GEMINI_MAX_RETRIES = int(os.environ.get("GEMINI_MAX_RETRIES", "3"))

_GEMINI_REQUEST_LOCK = asyncio.Lock()
_GEMINI_LAST_CALL_AT = 0.0
_GEMINI_CALL_TICKETS: list[float] = []


@dataclass
class WebExtractResult:
    title: str
    text: str
    url: str
    success: bool
    error: Optional[str] = None
    provider: str = "gemini_computer_use"


@dataclass
class WebScreenshotResult:
    title: str
    url: str
    screenshots: list[bytes]
    success: bool
    error: Optional[str] = None
    provider: str = "gemini_computer_use"


BLOCK_PATTERNS = [
    "show us your human side",
    "are you a human",
    "verify you are human",
    "captcha",
    "access denied",
    "security check",
    "cloudflare",
    "unusual traffic",
    "please enable javascript",
    "bot",
]


def _normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        return f"https://{url}"
    return url


def _modifier_key() -> str:
    return "Meta" if platform.system().lower() == "darwin" else "Control"


def _looks_blocked(text: str) -> bool:
    lower = (text or "").lower()
    return any(pattern in lower for pattern in BLOCK_PATTERNS)


def _looks_useful(text: str) -> bool:
    if not text:
        return False
    cleaned = re.sub(r"\s+", " ", text).strip()
    return len(cleaned) >= 500 and not _looks_blocked(cleaned)


def _build_prompt(url: str) -> str:
    return f"""You are a browser extraction agent for a travel app.

Goal: make the readable text on this page accessible with the fewest steps.

Rules:
1. Prefer copy/text-selection actions first if the page is already readable.
2. Use screenshots only when text is hidden, blocked, or not yet loaded.
3. Dismiss cookie banners, newsletter modals, age gates, and human checks only if they block the page.
4. Do not click random recommendations, ads, login buttons, or unrelated links.
5. Stay on this page. Do not search the web.
6. Stop as soon as the main article or page text is visible.
7. If the page exposes clean text in the browser, keep it simple and avoid extra navigation.

Target URL: {url}
"""


def _make_client() -> genai.Client:
    if genai is None:
        raise ValueError(
            "google-genai is not installed. Run `pip install google-genai` in the backend environment."
        ) from _GENAI_IMPORT_ERROR
    if not GEMINI_API_KEY:
        raise ValueError(
            "GEMINI_API_KEY is not configured. Set GEMINI_API_KEY or GOOGLE_API_KEY."
        )
    return genai.Client(api_key=GEMINI_API_KEY)


def _make_computer_use_tool() -> types.Tool:
    return types.Tool(
        computerUse=types.ComputerUse(
            environment=types.Environment.ENVIRONMENT_BROWSER,
            excludedPredefinedFunctions=["drag_and_drop"],
            enablePromptInjectionDetection=True,
        )
    )


def _build_screenshot_prompt(url: str) -> str:
    return f"""You are a browser automation agent for a travel app.

Task: scroll down and take screenshots from top to bottom until the bottom of the page.

Rules:
1. Set the page zoom to 67% if possible.
2. Start from the top and capture up to 8 screenshots.
3. If the next screenshot looks identical to the previous one, stop. That means you reached the bottom.
4. Ignore any non-blocking ad overlays that do not cover main content.
5. If a modal, cookie wall, or popup blocks scrolling, close it first before continuing.
6. If you try to close blocking popups more than 2 times without success, stop immediately.
7. Do not browse away from this page.
8. Use the current screenshot only. Do not rely on prior turns.

Target URL: {url}
"""


def _build_popup_close_prompt(url: str) -> str:
    return f"""You are helping the browser automation agent clear a blocking popup.

Task: close any modal, cookie wall, or popup that prevents scrolling.

Rules:
1. Only close blocking popups.
2. Ignore non-blocking ad overlays that do not prevent scrolling.
3. If you cannot close the blocking popup right now, return without making random clicks.
4. Use the current screenshot only.

Target URL: {url}
"""


def _ensure_screenshot_dir(url: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9]+", "_", url).strip("_")[:80] or "page"
    run_dir = COMPUTER_USE_SCREENSHOT_DIR / f"{safe}_{os.getpid()}_{hashlib.md5(url.encode()).hexdigest()[:8]}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def _save_screenshot(run_dir: Path, index: int, image: bytes) -> Path:
    path = run_dir / f"{index:02d}.png"
    path.write_bytes(image)
    return path


def _same_screenshot(prev: bytes | None, curr: bytes | None) -> bool:
    if not prev or not curr:
        return False
    return hashlib.md5(prev).hexdigest() == hashlib.md5(curr).hexdigest()


async def _page_scroll_summary(page) -> tuple[int, int, int]:
    return await page.evaluate(
        """() => {
            const doc = document.documentElement;
            const body = document.body;
            const scrollTop = Math.max(window.scrollY || 0, doc.scrollTop || 0, body?.scrollTop || 0);
            const scrollHeight = Math.max(
                doc.scrollHeight || 0,
                body?.scrollHeight || 0,
                document.body?.offsetHeight || 0,
                doc.offsetHeight || 0
            );
            const viewport = window.innerHeight || doc.clientHeight || 0;
            return [scrollTop, scrollHeight, viewport];
        }"""
    )


async def extract_web_text(url: str, max_turns: int = 6) -> WebExtractResult:
    """Extract page text from a potentially anti-bot URL."""
    url = _normalize_url(url)
    client = _make_client()
    tool = _make_computer_use_tool()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(1500)

            fast = await _extract_dom_text(page)
            if _looks_useful(fast.text):
                await browser.close()
                return fast

            prompt = _build_prompt(url)
            logger.info("Gemini computer-use input | url=%s | prompt=%s", url, _truncate_for_log(prompt))
            contents = [prompt, types.Part.from_bytes(data=await page.screenshot(type="png"), mime_type="image/png")]

            for _ in range(max_turns):
                response = await _generate_content(client, tool, contents, image_size=COMPUTER_USE_IMAGE_SIZE)
                logger.info(
                    "Gemini computer-use output | url=%s | %s",
                    url,
                    _summarize_response(response),
                )
                function_calls = _extract_function_calls(response)
                if not function_calls:
                    break

                for call in function_calls:
                    await _execute_function_call(call, page)

                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5000)
                except Exception:
                    pass
                await page.wait_for_timeout(1000)

                extracted = await _extract_dom_text(page)
                if _looks_useful(extracted.text):
                    await browser.close()
                    return extracted

                contents = [
                    prompt,
                    types.Part.from_bytes(
                        data=await page.screenshot(type="png"),
                        mime_type="image/png",
                    ),
                ]

            final_extract = await _extract_dom_text(page)
            if _looks_useful(final_extract.text):
                await browser.close()
                return final_extract

            if _looks_blocked(final_extract.text):
                await browser.close()
                return WebExtractResult(
                    title=final_extract.title,
                    text="",
                    url=final_extract.url,
                    success=False,
                    error="Blocked by anti-bot page",
                )

            await browser.close()
            return WebExtractResult(
                title=final_extract.title,
                text=final_extract.text,
                url=final_extract.url,
                success=bool(final_extract.text.strip()),
                error=None if final_extract.text.strip() else "No useful content extracted",
            )
        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            return WebExtractResult(title="", text="", url=url, success=False, error=str(e))


async def extract_web_screenshots(url: str, max_turns: int = 6) -> WebScreenshotResult:
    """Use Gemini computer-use to drive the page and collect screenshots."""
    url = _normalize_url(url)
    client = _make_client()
    tool = _make_computer_use_tool()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()
        screenshots: list[bytes] = []
        run_dir = _ensure_screenshot_dir(url)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(1500)
            initial = await page.screenshot(type="png")
            screenshots.append(initial)
            _save_screenshot(run_dir, 1, initial)
            await page.evaluate("document.body.style.zoom = '67%'")

            prompt = _build_screenshot_prompt(url)
            contents = [prompt, types.Part.from_bytes(data=screenshots[-1], mime_type="image/png")]
            close_attempts = 0
            prev_screenshot = initial

            for turn in range(2, min(COMPUTER_USE_MAX_SCREENSHOTS, max_turns) + 1):
                response = await _generate_content(client, tool, contents, image_size=COMPUTER_USE_IMAGE_SIZE)
                function_calls = _extract_function_calls(response)
                if not function_calls:
                    break

                requested_scroll = False
                for call in function_calls:
                    if call.get("name") in {"scroll_document", "scroll_at"}:
                        requested_scroll = True
                    await _execute_function_call(call, page)

                if requested_scroll:
                    scroll_top, scroll_height, viewport = await _page_scroll_summary(page)
                    at_bottom = scroll_top + viewport >= scroll_height - 8
                    if at_bottom:
                        break
                    next_shot = await page.screenshot(type="png")
                    if _same_screenshot(prev_screenshot, next_shot):
                        close_attempts += 1
                        if close_attempts > 2:
                            break
                        close_prompt = _build_popup_close_prompt(url)
                        contents = [close_prompt, types.Part.from_bytes(data=prev_screenshot, mime_type="image/png")]
                        continue
                    close_attempts = 0
                    screenshots.append(next_shot)
                    _save_screenshot(run_dir, turn, next_shot)
                    prev_screenshot = next_shot
                    contents = [prompt, types.Part.from_bytes(data=next_shot, mime_type="image/png")]
                    continue

                await page.wait_for_timeout(800)
                next_shot = await page.screenshot(type="png")
                if _same_screenshot(prev_screenshot, next_shot):
                    break
                screenshots.append(next_shot)
                _save_screenshot(run_dir, turn, next_shot)
                prev_screenshot = next_shot
                contents = [prompt, types.Part.from_bytes(data=next_shot, mime_type="image/png")]

            await browser.close()
            return WebScreenshotResult(
                title=await page.title(),
                url=page.url,
                screenshots=screenshots[:COMPUTER_USE_MAX_SCREENSHOTS],
                success=bool(screenshots),
                error=None,
            )
        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            return WebScreenshotResult(title="", url=url, screenshots=screenshots[:COMPUTER_USE_MAX_SCREENSHOTS], success=False, error=str(e))


async def _extract_dom_text(page) -> WebExtractResult:
    title = await page.title()
    try:
        text = await page.evaluate(
            """() => {
                const candidates = [
                    document.querySelector('article'),
                    document.querySelector('main'),
                    document.body,
                ].filter(Boolean);
                const target = candidates[0];
                if (!target) return '';
                return target.innerText || target.textContent || '';
            }"""
        )
    except Exception:
        text = ""

    cleaned = re.sub(r"\n{3,}", "\n\n", (text or "").strip())
    bundle = f"{title}\n\n{cleaned}" if title else cleaned
    return WebExtractResult(
        title=title or "",
        text=bundle,
        url=page.url,
        success=bool(cleaned),
    )


async def _generate_content(client: genai.Client, tool: types.Tool, contents, *, image_size: str | None = None):
    image_config = types.ImageConfig(imageSize=image_size) if image_size else None
    config = types.GenerateContentConfig(
        tools=[tool],
        temperature=0.0,
        maxOutputTokens=1024,
        imageConfig=image_config,
    )
    return await _generate_content_with_limits(
        client=client,
        contents=contents,
        config=config,
    )


async def _generate_content_with_limits(
    client: genai.Client,
    contents,
    config,
):
    for attempt in range(1, GEMINI_MAX_RETRIES + 1):
        await _acquire_gemini_slot()
        try:
            return await asyncio.to_thread(
                client.models.generate_content,
                model=GEMINI_COMPUTER_USE_MODEL,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            retry_after = _retry_after_seconds(exc)
            if retry_after is None or attempt >= GEMINI_MAX_RETRIES:
                raise
            logger.warning(
                "Gemini 429 retry | attempt=%s/%s | wait=%.1fs | error=%s",
                attempt,
                GEMINI_MAX_RETRIES,
                retry_after,
                exc,
            )
            await asyncio.sleep(retry_after)


async def _acquire_gemini_slot() -> None:
    global _GEMINI_LAST_CALL_AT, _GEMINI_CALL_TICKETS
    async with _GEMINI_REQUEST_LOCK:
        now = asyncio.get_event_loop().time()
        _GEMINI_CALL_TICKETS = [t for t in _GEMINI_CALL_TICKETS if now - t < 60.0]
        while len(_GEMINI_CALL_TICKETS) >= 5:
            wait_s = 60.0 - (now - _GEMINI_CALL_TICKETS[0]) + 0.05
            await asyncio.sleep(max(wait_s, 0.1))
            now = asyncio.get_event_loop().time()
            _GEMINI_CALL_TICKETS = [t for t in _GEMINI_CALL_TICKETS if now - t < 60.0]

        elapsed = now - _GEMINI_LAST_CALL_AT
        if _GEMINI_LAST_CALL_AT > 0 and elapsed < GEMINI_MIN_CALL_INTERVAL_S:
            await asyncio.sleep(GEMINI_MIN_CALL_INTERVAL_S - elapsed)
            now = asyncio.get_event_loop().time()

        _GEMINI_LAST_CALL_AT = now
        _GEMINI_CALL_TICKETS.append(now)


def _retry_after_seconds(exc: Exception) -> float | None:
    status_code = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    exc_name = exc.__class__.__name__.lower()
    exc_text = str(exc).lower()
    if status_code != 429 and "toomanyrequests" not in exc_name and "429" not in exc_text:
        return None

    headers = getattr(getattr(exc, "response", None), "headers", {}) or {}
    retry_after = headers.get("Retry-After") or headers.get("retry-after")
    if retry_after:
        try:
            return max(float(retry_after), 1.0)
        except Exception:
            try:
                retry_dt = datetime.strptime(retry_after, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc)
                delta = (retry_dt - datetime.now(timezone.utc)).total_seconds()
                return max(delta, 1.0)
            except Exception:
                return 15.0
    return 15.0


def _truncate_for_log(value: str, limit: int = 4000) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + f"... <truncated {len(value) - limit} chars>"


def _summarize_response(response) -> str:
    parts = []
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            text = getattr(part, "text", None)
            if text:
                parts.append(f"text={_truncate_for_log(text, 1000)}")
            function_call = getattr(part, "function_call", None)
            if function_call:
                parts.append(
                    f"function_call={getattr(function_call, 'name', '')}:{getattr(function_call, 'args', {})}"
                )
    if not parts:
        return "no textual output"
    return " | ".join(parts)


def _extract_function_calls(response) -> list[dict]:
    calls: list[dict] = []
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            function_call = getattr(part, "function_call", None)
            if function_call:
                args = getattr(function_call, "args", None) or {}
                calls.append({
                    "name": getattr(function_call, "name", ""),
                    "arguments": args,
                })
    return calls


async def _execute_function_call(call: dict, page) -> None:
    """Execute Gemini computer-use actions with Playwright."""
    fname = call.get("name", "")
    args = call.get("arguments", {}) or {}

    if fname in ("click", "click_at", "double_click", "right_click", "middle_click", "move"):
        x = _denormalize_x(args.get("x", 0), 1440)
        y = _denormalize_y(args.get("y", 0), 900)
        if fname in ("click", "click_at"):
            await page.mouse.click(x, y)
        elif fname == "double_click":
            await page.mouse.dblclick(x, y)
        elif fname == "right_click":
            await page.mouse.click(x, y, button="right")
        elif fname == "middle_click":
            await page.mouse.click(x, y, button="middle")
        elif fname == "move":
            await page.mouse.move(x, y)
    elif fname in ("type", "type_text_at"):
        x = args.get("x")
        y = args.get("y")
        text = args.get("text", "")
        press_enter = bool(args.get("press_enter", False))
        if x is not None and y is not None:
            await page.mouse.click(_denormalize_x(x, 1440), _denormalize_y(y, 900))
        await _clear_and_type(page, text, press_enter=press_enter)
    elif fname == "scroll_document":
        dy = int(args.get("delta_y", 800))
        await page.mouse.wheel(0, dy)
    elif fname in ("key_combination", "keypress"):
        combo = args.get("keys") or args.get("key") or ""
        if combo:
            await page.keyboard.press(_normalize_key_combo(combo))
    elif fname == "wait":
        await page.wait_for_timeout(int(args.get("seconds", 1)) * 1000)
    elif fname == "navigate":
        await page.goto(args.get("url", page.url), wait_until="domcontentloaded")
    elif fname == "go_back":
        await page.go_back()
    elif fname == "go_forward":
        await page.go_forward()
    else:
        return


async def _clear_and_type(page, text: str, press_enter: bool = False) -> None:
    mod = _modifier_key()
    await page.keyboard.press(f"{mod}+A")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(text)
    if press_enter:
        await page.keyboard.press("Enter")


def _normalize_key_combo(combo: str) -> str:
    return combo.replace("Cmd", "Meta").replace("Command", "Meta").replace("Ctrl", "Control")


def _denormalize_x(value: float, width: int) -> int:
    return int((value / 1000.0) * width)


def _denormalize_y(value: float, height: int) -> int:
    return int((value / 1000.0) * height)
