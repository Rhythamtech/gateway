"""Sanitization of request payloads before they are stored or returned.

Credentials, authorization headers, API keys and other secrets must never
reach trace records, logs, or trace API responses. Payloads are stored once
per message and referenced by every call trace; the boundary pass here is
the single redaction contract, and ``service.record_attempt`` re-sanitizes
stored payloads defensively without relying on it (defense in depth).
"""

import json
from typing import Any

REDACTED = "[REDACTED]"
TRUNCATED_SUFFIX = "...[TRUNCATED]"

# Exact (lowercased) key names treated as secrets. Key names are compared
# exactly to avoid over-redacting innocuous fields such as "keys".
_SENSITIVE_KEYS = frozenset(
    {
        "authorization",
        "x-api-key",
        "api-key",
        "apikey",
        "api_key",
        "key",
        "secret",
        "password",
        "token",
        "bearer_token",
        "bearer",
        "credential",
        "credentials",
    }
)

# Large payloads are capped aggressively: they are stored once per message,
# but a run-away prompt should not inflate trace storage unboundedly.
MAX_BYTES = 65536
_MAX_STRING_LENGTH = 4096
_FALLBACK_STRING_LENGTH = 256


def _sanitize(value: Any, *, string_limit: int) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in _SENSITIVE_KEYS:
                result[str(key)] = REDACTED
            else:
                result[str(key)] = _sanitize(item, string_limit=string_limit)
        return result

    if isinstance(value, (list, tuple)):
        return [_sanitize(item, string_limit=string_limit) for item in value]

    if isinstance(value, str):
        if len(value) > string_limit:
            return value[:string_limit] + TRUNCATED_SUFFIX
        return value

    return value


def sanitize_request_payload(payload: Any) -> Any:
    """Return a redacted, size-capped copy of a request payload."""

    # JSON representations never include non-serializable values; every input
    # crosses the wire as JSON first, so dumping to check the size is safe.
    try:
        encoded = json.dumps(_sanitize(payload, string_limit=_MAX_STRING_LENGTH))
    except (TypeError, ValueError):
        encoded = json.dumps(_sanitize(str(payload), string_limit=_MAX_STRING_LENGTH))

    if len(encoded.encode("utf-8")) <= MAX_BYTES:
        return _sanitize(payload, string_limit=_MAX_STRING_LENGTH)

    try:
        encoded = json.dumps(_sanitize(payload, string_limit=_FALLBACK_STRING_LENGTH))
        if len(encoded.encode("utf-8")) <= MAX_BYTES:
            return _sanitize(payload, string_limit=_FALLBACK_STRING_LENGTH)
    except (TypeError, ValueError):
        pass

    if isinstance(payload, dict):
        note = {
            "truncated": True,
            "top_level_keys": sorted(str(k) for k in payload.keys()),
            "note": "Request payload exceeded the trace size cap and was reduced to metadata.",
        }
        return note

    return {"truncated": True, "note": "Request payload exceeded the trace size cap."}


def serialize_request_payload(payload: Any) -> str:
    """Sanitized JSON string for trace storage."""

    return json.dumps(sanitize_request_payload(payload), separators=(",", ":"), ensure_ascii=False)
