"""GLM-OCR service using Zhipu AI's Layout Parsing API.

Endpoint: POST https://open.bigmodel.cn/api/paas/v4/layout_parsing
Format: application/json with base64-encoded image
Model: glm-ocr (dedicated OCR model)
"""

import asyncio
import base64
import os
from typing import Optional

import httpx

GLM_API_KEY = os.environ.get("GLM_API_KEY", "")
GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/layout_parsing"

MAX_IMAGES = 3


async def ocr_image(image_data: bytes) -> Optional[str]:
    """Send a single image to GLM-OCR via JSON with base64 image."""
    if not GLM_API_KEY:
        print("[GLM-OCR] SKIPPED: No GLM_API_KEY configured")
        return None

    # Convert to JPEG if not already JPG/PNG (handles HEIC from iPhones)
    img_bytes = image_data
    is_jpeg = image_data[:4] == b"\xff\xd8\xff"
    is_png = image_data[:4] == b"\x89PNG"
    if not is_jpeg and not is_png:
        try:
            from io import BytesIO

            from PIL import Image
            pil_img = Image.open(BytesIO(image_data))
            out = BytesIO()
            pil_img.convert("RGB").save(out, format="JPEG", quality=85)
            img_bytes = out.getvalue()
            print(f"[GLM-OCR] Converted image from HEIC/WEBP to JPEG ({len(img_bytes)} bytes)")
        except ImportError:
            print("[GLM-OCR] PIL not available, sending as-is")
        except Exception as e:
            print(f"[GLM-OCR] Image conversion failed: {e}, sending as-is")

    b64 = base64.b64encode(img_bytes).decode("utf-8")
    data_uri = f"data:image/jpeg;base64,{b64}"

    headers = {
        "Authorization": f"Bearer {GLM_API_KEY}",
        "Content-Type": "application/json",
    }

    # The Layout Parsing API expects the file directly, not in messages
    payload = {
        "model": "glm-ocr",
        "file": data_uri,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                GLM_API_URL, headers=headers, json=payload
            )
            if response.status_code != 200:
                print(f"[GLM-OCR] HTTP {response.status_code}: {response.text[:500]}")
            response.raise_for_status()
            data = response.json()

        if "error" in data:
            err = data["error"]
            print(f"[GLM-OCR] API error: {err.get('message', str(err))}")
            return None

        # Layout Parsing API returns extracted text in md_results
        text = (
            data.get("md_results", "")
            or data.get("content", "")
            or data.get("text", "")
            or data.get("result", "")
            or ""
        )
        # md_results might be a list
        if isinstance(text, list):
            text = "\n".join(str(item) for item in text)
        if not text:
            print(f"[GLM-OCR] Empty response. Keys: {list(data.keys())}")
            if data.get("choices"):
                print(f"[GLM-OCR] First choice: {str(data['choices'][0])[:200]}")
            return None

        print(f"[GLM-OCR] Extracted {len(text)} chars from image")
        return text

    except httpx.HTTPStatusError as e:
        print(
            f"[GLM-OCR] HTTP error: {e.response.status_code} - {e.response.text[:500]}"
        )
        return None
    except httpx.TimeoutException:
        print("[GLM-OCR] Timeout after 60s")
        return None
    except Exception as e:
        import traceback

        print(f"[GLM-OCR] Failed: {e}")
        traceback.print_exc()
        return None


async def ocr_images(images: list[bytes]) -> str:
    """OCR multiple images and return combined text."""
    if not images:
        return ""

    images = images[:MAX_IMAGES]
    # Each image is independent. Running OCR sequentially makes a three-image
    # import wait for up to three provider round trips before parsing can start.
    # Keep source order when joining so downstream context remains predictable.
    extracted = await asyncio.gather(*(ocr_image(image) for image in images))
    results = [
        f"--- Image {index + 1} ---\n{text}"
        for index, text in enumerate(extracted)
        if text
    ]

    combined = "\n\n".join(results)
    print(f"[GLM-OCR] Total: {len(images)} image(s), {len(combined)} chars extracted")
    return combined
