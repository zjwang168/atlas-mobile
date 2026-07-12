"""In-memory progress events for long-running parse requests."""

import time
from collections import OrderedDict
from typing import Any

_PROGRESS: OrderedDict[str, dict[str, Any]] = OrderedDict()
_MAX_PROGRESS = 100


def start(request_id: str, label: str = "Starting") -> None:
    now = time.time()
    _PROGRESS[request_id] = {
        "request_id": request_id,
        "started_at": now,
        "updated_at": now,
        "status": "running",
        "events": [
            {
                "key": "started",
                "label": label,
                "elapsed_s": 0,
                "data": {},
            }
        ],
    }
    while len(_PROGRESS) > _MAX_PROGRESS:
        _PROGRESS.popitem(last=False)


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


def finish(request_id: str | None, data: dict[str, Any] | None = None) -> None:
    if not request_id:
        return
    mark(request_id, "finished", "Finished.", data)
    if request_id in _PROGRESS:
        _PROGRESS[request_id]["status"] = "finished"


def fail(request_id: str | None, message: str) -> None:
    if not request_id:
        return
    mark(request_id, "failed", "Failed.", {"message": message})
    if request_id in _PROGRESS:
        _PROGRESS[request_id]["status"] = "failed"


def get(request_id: str) -> dict[str, Any]:
    entry = _PROGRESS.get(request_id)
    if not entry:
        return {
            "request_id": request_id,
            "status": "unknown",
            "events": [],
        }
    return entry
