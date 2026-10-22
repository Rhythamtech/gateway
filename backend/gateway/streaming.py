import json
from typing import Any


def sse(data: Any, event: str | None = None) -> str:
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    prefix = f"event: {event}\n" if event else ""
    return prefix + "data: " + payload + "\n\n"
