"""In-memory progress events for long-running parse requests."""

import asyncio
import time
from collections import OrderedDict
from typing import Any, Callable

_PROGRESS: OrderedDict[str, dict[str, Any]] = OrderedDict()
_MAX_PROGRESS = 100
_LISTENERS: dict[str, list[Callable[[dict[str, Any]], None]]] = {}
_TASKS: dict[str, asyncio.Task[Any]] = {}
_CANCELLED: set[str] = set()


def start(request_id: str, label: str = "Starting") -> None:
    if request_id in _CANCELLED:
        # A client can cancel immediately after receiving its request ID,
        # before this endpoint begins work. Do not let that race start it.
        raise asyncio.CancelledError(f"Parse request {request_id} was cancelled")
    now = time.time()
    _PROGRESS[request_id] = {
        "request_id": request_id,
        "started_at": now,
        "updated_at": now,
        "status": "running",
        "stream_sequence": 0,
        "events": [
            {
                "key": "started",
                "label": label,
                "elapsed_s": 0,
                "data": {},
            }
        ],
    }
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    if task:
        _TASKS[request_id] = task
    while len(_PROGRESS) > _MAX_PROGRESS:
        _PROGRESS.popitem(last=False)


def add_listener(request_id: str, listener: Callable[[dict[str, Any]], None]) -> None:
    listeners = _LISTENERS.setdefault(request_id, [])
    listeners.append(listener)


def remove_listener(request_id: str, listener: Callable[[dict[str, Any]], None]) -> None:
    listeners = _LISTENERS.get(request_id)
    if not listeners:
        return
    try:
        listeners.remove(listener)
    except ValueError:
        pass
    if not listeners:
        _LISTENERS.pop(request_id, None)


def _notify(request_id: str, entry: dict[str, Any]) -> None:
    for listener in list(_LISTENERS.get(request_id, [])):
        try:
            listener(entry)
        except Exception:
            pass


def mark(request_id: str | None, key: str, label: str, data: dict[str, Any] | None = None) -> None:
    if not request_id:
        return
    entry = _PROGRESS.get(request_id)
    if not entry:
        start(request_id)
        entry = _PROGRESS[request_id]

    now = time.time()
    entry["updated_at"] = now
    entry["events"].append({
        "key": key,
        "label": label,
        "elapsed_s": round(now - entry["started_at"]),
        "data": data or {},
    })
    _PROGRESS.move_to_end(request_id)
    _notify(request_id, entry)


def finish(request_id: str | None, data: dict[str, Any] | None = None) -> None:
    if not request_id:
        return
    mark(request_id, "finished", "Finished.", data)
    if request_id in _PROGRESS:
        _PROGRESS[request_id]["status"] = "finished"
    _TASKS.pop(request_id, None)


def fail(request_id: str | None, message: str) -> None:
    if not request_id:
        return
    mark(request_id, "failed", "Failed.", {"message": message})
    if request_id in _PROGRESS:
        _PROGRESS[request_id]["status"] = "failed"
    _TASKS.pop(request_id, None)


def cancel(request_id: str) -> bool:
    """Stop the request task and prevent a not-yet-started request from running."""
    entry = _PROGRESS.get(request_id)
    if entry and entry.get("status") in {"finished", "failed", "cancelled"}:
        return False

    _CANCELLED.add(request_id)
    if entry:
        mark(request_id, "cancelled", "Cancelled.", {})
        entry["status"] = "cancelled"
    else:
        now = time.time()
        _PROGRESS[request_id] = {
            "request_id": request_id,
            "started_at": now,
            "updated_at": now,
            "status": "cancelled",
            "events": [{"key": "cancelled", "label": "Cancelled.", "elapsed_s": 0, "data": {}}],
        }

    task = _TASKS.pop(request_id, None)
    if task and not task.done():
        task.cancel()
    return True


def get(request_id: str) -> dict[str, Any]:
    entry = _PROGRESS.get(request_id)
    if not entry:
        return {
            "request_id": request_id,
            "status": "unknown",
            "events": [],
        }
    return entry


def stream_note(request_id: str | None, label: str, data: dict[str, Any] | None = None) -> None:
    if not request_id:
        return
    entry = _PROGRESS.get(request_id)
    if not entry:
        start(request_id)
        entry = _PROGRESS[request_id]
    # Several pipeline stages can emit within a single millisecond. A per-
    # request sequence is unique and keeps event identity stable for the UI.
    entry["stream_sequence"] = int(entry.get("stream_sequence", 0)) + 1
    mark(request_id, f"stream_{entry['stream_sequence']}", label, data or {})


def stream_identified_places(request_id: str | None, locations: list[dict[str, Any]], limit: int = 12) -> None:
    """Send a bounded set of actual extracted place names to the progress UI."""
    seen: set[str] = set()
    for location in locations:
        name = str(location.get("name") or "").strip()
        normalized = name.casefold()
        if not name or normalized in seen:
            continue
        seen.add(normalized)
        stream_note(request_id, "place:identified", {"name": name})
        if len(seen) >= limit:
            break
