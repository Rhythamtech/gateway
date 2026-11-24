"""Sanitization of request payloads before they are stored or returned.

Credentials, authorization headers, API keys and other secrets must never
reach trace records, logs, or trace API responses. Payloads are stored once
per message and referenced by every call trace; the boundary pass here is
the single redaction contract, and ``service.record_attempt`` re-sanitizes
stored payloads defensively without relying on it (defense in depth).
"""

import json
from collections.abc import Callable
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
        "client_secret",
        "token",
        "access_token",
        "refresh_token",
        "bearer_token",
        "bearer",
        "cookie",
        "set-cookie",
        "credential",
        "credentials",
    }
)

# Large payloads are capped aggressively: they are stored once per message,
# but a run-away prompt should not inflate trace storage unboundedly.
MAX_BYTES = 65536
_MAX_STRING_LENGTH = 4096
_FALLBACK_STRING_LENGTH = 256


def _sanitize(
    value: Any,
    *,
    string_limit: int,
    redact_text: Callable[[str], str] = str,
) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).lower()
            safe_key = redact_text(str(key))
            if lowered in _SENSITIVE_KEYS:
                result[safe_key] = REDACTED
            else:
                result[safe_key] = _sanitize(
                    item, string_limit=string_limit, redact_text=redact_text
                )
        return result

    if isinstance(value, (list, tuple)):
        return [
            _sanitize(item, string_limit=string_limit, redact_text=redact_text)
            for item in value
        ]

    if isinstance(value, str):
        value = redact_text(value)
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


def provider_error_details(
    body: Any, *, secrets: tuple[str, ...]
) -> dict[str, Any]:
    """Extract the provider's own identifiers and message from a redacted body."""

    if isinstance(body, str):
        try:
            body = json.loads(body)
        except (ValueError, RecursionError):
            pass

    def redact_text(value: str) -> str:
        for secret in secrets:
            value = value.replace(secret, REDACTED)
        return value

    try:
        body = _sanitize(body, string_limit=_MAX_STRING_LENGTH, redact_text=redact_text)
        encoded = json.dumps(body, allow_nan=False)
    except (ValueError, RecursionError):
        return {}
    if len(encoded) > MAX_BYTES:
        return {}

    envelope = body if isinstance(body, dict) else {}
    error = envelope.get("error", body)
    fields = error if isinstance(error, dict) else envelope
    message = (
        fields.get("message")
        or envelope.get("message")
        or envelope.get("detail")
        or (error if isinstance(error, str) else None)
    )
    code = fields.get("code")
    error_type = fields.get("type") or fields.get("status")
    return {
        "provider_message": message if isinstance(message, str) and message.strip() else None,
        "provider_code": str(code) if isinstance(code, str) or type(code) is int else None,
        "provider_type": error_type if isinstance(error_type, str) and error_type != "error" else None,
        "provider_response": body,
    }
