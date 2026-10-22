import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.header_safety import build_headers
from backend.core.http_safety import ensure_safe_outbound_url, provider_api_url
from backend.gateway.provider_models.dtos import (
    ModelSyncResponse,
    ProviderModelResponse,
    SyncedModel,
)
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.models import Provider
from backend.gateway.providers.service import (
    MAX_MODEL_NAME_LENGTH,
    ProviderConfigurationError,
    build_model_id,
    build_runtime_provider,
    get_provider_or_404,
)

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_model_response(model: ProviderModel) -> ProviderModelResponse:
    return ProviderModelResponse(
        id=model.id,
        provider_id=model.provider_id,
        model_name=model.model_name,
        model_id=model.model_id,
        is_available=model.is_available,
        last_seen_at=model.last_seen_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def list_available_models(db: Session) -> list[tuple[ProviderModel, Provider]]:
    """Return available models for enabled providers."""

    rows = (
        db.query(ProviderModel, Provider)
        .join(Provider, ProviderModel.provider_id == Provider.id)
        .filter(Provider.is_enabled.is_(True))
        .filter(ProviderModel.is_available.is_(True))
        .order_by(ProviderModel.model_id)
        .all()
    )

    return [(model, provider) for model, provider in rows]


def list_provider_models(db: Session, provider_id: str) -> list[ProviderModelResponse]:
    get_provider_or_404(db, provider_id)

    models = (
        db.query(ProviderModel)
        .filter(ProviderModel.provider_id == provider_id)
        .order_by(ProviderModel.model_name)
        .all()
    )

    return [to_model_response(model) for model in models]


def _validate_redirect(current_url: str, next_url: str) -> None:
    try:
        current = urlsplit(current_url)
        target = urlsplit(next_url)
        current_port = current.port or (443 if current.scheme.lower() == "https" else 80)
        target_port = target.port or (443 if target.scheme.lower() == "https" else 80)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Provider returned an invalid redirect",
        ) from None

    if target.scheme.lower() not in {"http", "https"} or not target.hostname:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Provider returned an invalid redirect",
        )

    if target.username is not None or target.password is not None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Provider returned an unsafe redirect",
        )

    if (
        current.scheme.lower() != target.scheme.lower()
        or current.hostname != target.hostname
        or current_port != target_port
    ):
        # Do not forward provider credentials to a different origin.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Provider redirected to a different origin",
        )


async def _read_limited_body(response: httpx.Response) -> bytes:
    body = bytearray()

    async for chunk in response.aiter_bytes():
        body.extend(chunk)

        if len(body) > settings.PROVIDER_MAX_RESPONSE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Provider response exceeded the maximum allowed size",
            )

    return bytes(body)


def _extract_model_names(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Provider response must be a JSON object",
        )

    data = payload.get("data")

    if not isinstance(data, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Provider response must contain a 'data' list",
        )

    names: list[str] = []
    seen: set[str] = set()

    for item in data:
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Provider returned an invalid model entry",
            )

        model_name = item.get("id")

        if not isinstance(model_name, str) or not model_name.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Provider returned a model without a valid id",
            )

        if len(model_name) > MAX_MODEL_NAME_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Provider returned a model id that is too long",
            )

        # Preserve the upstream identifier exactly. Only deduplicate entries.
        if model_name in seen:
            continue

        seen.add(model_name)
        names.append(model_name)

    return names


async def fetch_upstream_model_names(
    models_url: str,
    headers: dict[str, str],
) -> list[str]:
    """Fetch and validate a provider's model list.

    Read-only with respect to the database. Any failure raises before the
    caller persists availability changes.
    """

    timeout = httpx.Timeout(
        settings.PROVIDER_REQUEST_TIMEOUT,
        connect=min(5.0, settings.PROVIDER_REQUEST_TIMEOUT),
    )

    current_url = models_url

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for redirect_count in range(settings.PROVIDER_MAX_REDIRECTS + 1):
            await ensure_safe_outbound_url(current_url)

            try:
                async with client.stream("GET", current_url, headers=headers) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")

                        if not location:
                            raise HTTPException(
                                status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="Provider returned a redirect without a location",
                            )

                        if redirect_count >= settings.PROVIDER_MAX_REDIRECTS:
                            raise HTTPException(
                                status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="Provider returned too many redirects",
                            )

                        next_url = urljoin(current_url, location)
                        _validate_redirect(current_url, next_url)
                        current_url = next_url
                        continue

                    if not 200 <= response.status_code < 300:
                        raise HTTPException(
                            status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"Provider models endpoint returned HTTP {response.status_code}",
                        )

                    body = await _read_limited_body(response)
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail="Provider request timed out",
                ) from None
            except httpx.HTTPError:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Provider request failed",
                ) from None

            try:
                payload = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Provider returned invalid JSON",
                ) from None

            return _extract_model_names(payload)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Provider returned too many redirects",
    )


def _persist_models(
    db: Session,
    provider_id: str,
    model_names: list[str],
) -> ModelSyncResponse:
    now = _utcnow()

    for attempt in range(2):
        try:
            # Lock the provider row where supported so an alias update cannot
            # race with model ID generation. SQLite serializes writers anyway.
            provider = (
                db.query(Provider)
                .filter(Provider.id == provider_id)
                .with_for_update()
                .first()
            )

            if not provider:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Provider not found",
                )

            existing = {
                model.model_name: model
                for model in db.query(ProviderModel)
                .filter(ProviderModel.provider_id == provider.id)
                .all()
            }

            created = 0
            updated = 0

            for model_name in model_names:
                model = existing.get(model_name)
                public_id = build_model_id(provider.aliases, model_name)

                if model:
                    model.model_id = public_id
                    model.is_available = True
                    model.last_seen_at = now
                    updated += 1
                else:
                    db.add(
                        ProviderModel(
                            provider_id=provider.id,
                            model_name=model_name,
                            model_id=public_id,
                            is_available=True,
                            last_seen_at=now,
                        )
                    )
                    created += 1

            present = set(model_names)
            unavailable = 0

            for model_name, model in existing.items():
                if model_name not in present and model.is_available:
                    model.is_available = False
                    unavailable += 1

            db.commit()

            return ModelSyncResponse(
                provider_id=provider.id,
                provider_alias=provider.aliases,
                synced=len(model_names),
                created=created,
                updated=updated,
                unavailable=unavailable,
                models=[
                    SyncedModel(
                        model_name=model_name,
                        model_id=build_model_id(provider.aliases, model_name),
                    )
                    for model_name in model_names
                ],
            )
        except IntegrityError:
            db.rollback()

            if attempt == 0:
                # A concurrent synchronization may have inserted the same
                # (provider_id, model_name) row. Re-read and upsert again.
                continue

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Model synchronization conflicted with another request",
            ) from None

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Model synchronization conflicted with another request",
    )


async def sync_provider_models(
    db: Session,
    provider_id: str,
) -> ModelSyncResponse:
    provider = get_provider_or_404(db, provider_id)

    try:
        runtime = build_runtime_provider(provider)
    except ProviderConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from None

    models_url = provider_api_url(provider.base_url, "/models")
    headers = build_headers(
        runtime.protocol,
        runtime.api_key,
        runtime.headers,
        content_type=None,
    )

    model_names = await fetch_upstream_model_names(models_url, headers)

    # No database writes happen until the upstream request and response have
    # been fully validated, so failures leave existing availability untouched.
    return _persist_models(db, provider.id, model_names)
