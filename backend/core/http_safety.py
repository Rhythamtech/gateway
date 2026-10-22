"""URL normalization and SSRF protection for provider management."""

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit

from fastapi import HTTPException, status

from backend.core.config import settings

_ALLOWED_SCHEMES = {"http", "https"}


def normalize_base_url(value: str) -> str:
    """Validate a provider base URL and normalize its trailing slashes."""

    raw = (value or "").strip()

    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url is required",
        )

    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in raw):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url contains invalid characters",
        )

    try:
        parsed = urlsplit(raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url is invalid",
        ) from None

    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url must use http or https",
        )

    if not parsed.hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url must include a host",
        )

    if parsed.username is not None or parsed.password is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url must not contain embedded credentials",
        )

    if parsed.query or parsed.fragment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url must not include a query or fragment",
        )

    try:
        port = parsed.port
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url contains an invalid port",
        ) from None

    host = parsed.hostname.lower()

    if ":" in host:
        host = f"[{host}]"

    netloc = host

    if port is not None:
        netloc = f"{netloc}:{port}"

    return urlunsplit((parsed.scheme.lower(), netloc, parsed.path.rstrip("/"), "", ""))


def provider_api_url(base_url: str, endpoint: str) -> str:
    """Build a provider API URL, tolerating base URLs with or without ``/v1``."""

    base = normalize_base_url(base_url)
    endpoint = "/" + endpoint.lstrip("/")

    if base.endswith("/v1"):
        return f"{base}{endpoint}"

    return f"{base}/v1{endpoint}"


def _resolve_and_validate(url: str) -> None:
    try:
        parsed = urlsplit(url)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provider URL is invalid",
        ) from None

    if parsed.scheme.lower() not in _ALLOWED_SCHEMES or not parsed.hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provider URL is invalid",
        )

    if settings.PROVIDER_ALLOW_PRIVATE_NETWORKS:
        return

    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)

    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Provider host could not be resolved",
        ) from None

    addresses = {info[4][0] for info in infos}

    if not addresses:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Provider host could not be resolved",
        )

    for address in addresses:
        try:
            is_public = ipaddress.ip_address(address).is_global
        except ValueError:
            is_public = False

        if not is_public:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provider URL resolves to a private or unsafe address",
            )


async def ensure_safe_outbound_url(url: str) -> None:
    """Resolve and validate the destination immediately before requesting it."""

    await asyncio.to_thread(_resolve_and_validate, url)
