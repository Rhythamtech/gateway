"""Validation and construction of provider HTTP headers."""

import json
import re
from typing import Mapping

from fastapi import HTTPException, status

# RFC 9110 token characters.
_HEADER_NAME_RE = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")

# Hop-by-hop headers, plus headers that would let a provider configuration
# alter the structure of the outbound request itself.
_DENIED_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

_MAX_HEADER_NAME_LENGTH = 256
_MAX_HEADER_VALUE_LENGTH = 8192
_MAX_HEADER_COUNT = 32


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _validate_pair(name: str, value: str) -> tuple[str, str]:
    name = name.strip()
    value = value.strip()

    if not name or not _HEADER_NAME_RE.fullmatch(name):
        raise _bad_request("custom_header contains an invalid header name")

    if len(name) > _MAX_HEADER_NAME_LENGTH:
        raise _bad_request("custom_header header name is too long")

    if name.lower() in _DENIED_HEADERS:
        raise _bad_request(f"custom_header must not set the hop-by-hop header {name}")

    if any(char in value for char in ("\r", "\n", "\x00")) or len(value) > _MAX_HEADER_VALUE_LENGTH:
        raise _bad_request("custom_header contains an invalid header value")

    return name, value


def parse_custom_header(value: str | None) -> dict[str, str]:
    """Parse a stored custom header configuration.

    Accepted formats:

    * ``{"X-API-Version": "2026-01-01"}`` (JSON object)
    * ``X-API-Version: 2026-01-01`` (one or more newline-separated headers)
    """

    if value is None:
        return {}

    raw = value.strip()

    if not raw:
        return {}

    headers: dict[str, str] = {}

    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            raise _bad_request("custom_header is not valid JSON") from None

        if not isinstance(parsed, dict):
            raise _bad_request("custom_header must be a JSON object")

        pairs = list(parsed.items())
    else:
        pairs = []

        for line in raw.splitlines():
            if not line.strip():
                continue

            if ":" not in line:
                raise _bad_request("custom_header must use 'Name: value' format")

            pairs.append(tuple(line.split(":", 1)))

    if len(pairs) > _MAX_HEADER_COUNT:
        raise _bad_request("custom_header contains too many headers")

    for name, header_value in pairs:
        if not isinstance(name, str) or not isinstance(header_value, str):
            raise _bad_request("custom_header values must be strings")

        validated_name, validated_value = _validate_pair(name, header_value)

        if validated_name.lower() in {existing.lower() for existing in headers}:
            raise _bad_request(f"custom_header sets {validated_name} more than once")

        headers[validated_name] = validated_value

    return headers


def serialize_custom_header(headers: Mapping[str, str]) -> str | None:
    if not headers:
        return None

    return json.dumps(dict(headers), ensure_ascii=False, separators=(",", ":"))


def build_headers(
    protocol: str,
    api_key: str,
    custom_headers: Mapping[str, str],
    *,
    content_type: str | None = "application/json",
) -> dict[str, str]:
    """Build outbound headers.

    Provider credentials are applied first. Custom headers are applied last, so
    a provider may deliberately override the default authentication header.
    Custom header values are never logged.
    """

    headers: dict[str, str] = {"Accept": "application/json"}

    if content_type:
        headers["Content-Type"] = content_type

    if protocol == "anthropic":
        if api_key:
            headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
    elif api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    headers.update(custom_headers)

    return headers
