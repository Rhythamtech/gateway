import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.crypto import CredentialError, decrypt_secret, encrypt_secret
from backend.core.database import SessionLocal
from backend.core.errors import GatewayError
from backend.core.header_safety import (
    build_headers as build_provider_headers,
    parse_custom_header,
    serialize_custom_header,
)
from backend.core.http_safety import normalize_base_url, provider_api_url
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.dtos import (
    ProviderCreateRequest,
    ProviderResponse,
    ProviderUpdateRequest,
)
from backend.gateway.providers.models import (
    Provider,
    ProviderAuditLog,
    ProviderProtocol,
)

logger = logging.getLogger(__name__)

_MAX_ROUTE_DEPTH = 5
_ALIAS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

MAX_ALIAS_LENGTH = 64
MAX_NAME_LENGTH = 255
MAX_MODEL_NAME_LENGTH = 255


class ProviderConfigurationError(Exception):
    """Stored provider configuration could not be used."""


@dataclass(frozen=True)
class RuntimeProvider:
    id: str
    name: str
    aliases: str
    base_url: str
    api_key: str
    protocol: str
    headers: dict[str, str]
    is_enabled: bool


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_name(value: str) -> str:
    name = (value or "").strip()

    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")

    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is too long")

    return name


def validate_alias(value: str) -> str:
    alias = (value or "").strip()

    if not alias:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="aliases is required",
        )

    if len(alias) > MAX_ALIAS_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="aliases is too long",
        )

    if "/" in alias:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="aliases must not contain '/'",
        )

    if not _ALIAS_RE.fullmatch(alias):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "aliases must start with a letter or digit and contain only "
                "letters, digits, '.', '_' or '-'"
            ),
        )

    return alias


def validate_protocol(value: str) -> str:
    try:
        return ProviderProtocol(value).value
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="protocol must be either 'openai' or 'anthropic'",
        ) from None


def build_model_id(alias: str, model_name: str) -> str:
    return f"{alias}/{model_name}"


# ---------------------------------------------------------------------------
# Runtime provider construction and routing
# ---------------------------------------------------------------------------


def build_runtime_provider(provider: Provider) -> RuntimeProvider:
    try:
        api_key = decrypt_secret(provider.api_key)
        custom_headers = (
            parse_custom_header(decrypt_secret(provider.custom_header))
            if provider.custom_header
            else {}
        )
    except CredentialError as error:
        raise ProviderConfigurationError("Provider credentials could not be decrypted") from error
    except HTTPException as error:
        raise ProviderConfigurationError("Provider headers are invalid") from error

    return RuntimeProvider(
        id=provider.id,
        name=provider.name,
        aliases=provider.aliases,
        base_url=provider.base_url,
        api_key=api_key,
        protocol=provider.protocol,
        headers=custom_headers,
        is_enabled=provider.is_enabled,
    )


def _get_provider_entity(db: Session, provider_alias: str) -> Provider | None:
    return db.query(Provider).filter(Provider.aliases == provider_alias).first()


def get_provider(
    provider_name: str,
    db: Session | None = None,
    *,
    include_disabled: bool = False,
) -> RuntimeProvider:
    owns_session = db is None
    session = db or SessionLocal()

    try:
        provider = _get_provider_entity(session, provider_name)
    finally:
        if owns_session:
            session.close()

    if not provider:
        raise GatewayError(
            400,
            "invalid_request_error",
            f"Unknown provider: {provider_name}",
        )

    if not provider.is_enabled and not include_disabled:
        raise GatewayError(
            400,
            "invalid_request_error",
            f"Provider is disabled: {provider_name}",
        )

    try:
        return build_runtime_provider(provider)
    except ProviderConfigurationError as error:
        raise GatewayError(500, "configuration_error", str(error)) from None


def resolve_model(
    model: str,
    db: Session | None = None,
    *,
    _depth: int = 0,
) -> tuple[str, str]:
    if not model:
        raise GatewayError(400, "invalid_request_error", "model is required")

    if _depth > _MAX_ROUTE_DEPTH:
        raise GatewayError(500, "configuration_error", "Model route configuration contains a cycle")

    owns_session = db is None
    session = db or SessionLocal()

    try:
        if "/" in model:
            provider_alias, upstream_model = model.split("/", 1)

            if provider_alias and upstream_model:
                provider = _get_provider_entity(session, provider_alias)

                if provider:
                    if not provider.is_enabled:
                        raise GatewayError(
                            400,
                            "invalid_request_error",
                            f"Provider is disabled: {provider_alias}",
                        )

                    return provider_alias, upstream_model

        routes = settings.ROUTER_MODEL_ROUTES

        if model in routes:
            return resolve_model(routes[model], session, _depth=_depth + 1)

        wildcard = routes.get("*")

        if wildcard:
            if "/" not in wildcard:
                raise GatewayError(
                    500,
                    "configuration_error",
                    "Wildcard model route must be in the form 'provider/prefix'",
                )

            provider_alias, prefix = wildcard.split("/", 1)
            provider = _get_provider_entity(session, provider_alias)

            if not provider or not provider.is_enabled:
                raise GatewayError(
                    500,
                    "configuration_error",
                    "Wildcard model route references an unknown or disabled provider",
                )

            if prefix == "*":
                return provider_alias, model

            return provider_alias, f"{prefix}/{model}"

        default_provider = settings.ROUTER_DEFAULT_PROVIDER

        if not default_provider:
            raise GatewayError(
                500,
                "configuration_error",
                "Default provider is not configured",
            )

        provider = _get_provider_entity(session, default_provider)

        if not provider or not provider.is_enabled:
            raise GatewayError(
                500,
                "configuration_error",
                "Default provider is not configured or is disabled",
            )

        return default_provider, model
    finally:
        if owns_session:
            session.close()


# ---------------------------------------------------------------------------
# Provider management
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_provider_or_404(db: Session, provider_id: str) -> Provider:
    provider = db.query(Provider).filter(Provider.id == provider_id).first()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    return provider


def _ensure_alias_available(
    db: Session,
    alias: str,
    *,
    exclude_provider_id: str | None = None,
) -> None:
    query = db.query(Provider).filter(func.lower(Provider.aliases) == alias.lower())

    if exclude_provider_id:
        query = query.filter(Provider.id != exclude_provider_id)

    if query.first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Provider alias already exists",
        )


def _normalize_custom_header(value: str | dict[str, str] | None) -> str | None:
    if value is None:
        return None

    raw = serialize_custom_header(value) if isinstance(value, dict) else value

    return serialize_custom_header(parse_custom_header(raw))


def _audit(
    db: Session,
    *,
    provider_id: str | None,
    actor_id: str | None,
    action: str,
    details: dict[str, Any],
) -> None:
    """Record an administrative action without credential material."""

    db.add(
        ProviderAuditLog(
            provider_id=provider_id,
            actor_id=actor_id,
            action=action,
            details=json.dumps(details, ensure_ascii=False, separators=(",", ":")),
        )
    )


def _commit(db: Session, conflict_message: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=conflict_message,
        ) from None


def to_provider_response(provider: Provider) -> ProviderResponse:
    return ProviderResponse(
        id=provider.id,
        name=provider.name,
        aliases=provider.aliases,
        base_url=provider.base_url,
        protocol=provider.protocol,
        is_enabled=provider.is_enabled,
        has_api_key=bool(provider.api_key),
        has_custom_header=bool(provider.custom_header),
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


def list_providers(db: Session) -> list[ProviderResponse]:
    providers = db.query(Provider).order_by(Provider.name).all()

    return [to_provider_response(provider) for provider in providers]


def get_provider_by_id(db: Session, provider_id: str) -> ProviderResponse:
    return to_provider_response(get_provider_or_404(db, provider_id))


def create_provider(
    db: Session,
    data: ProviderCreateRequest,
    *,
    actor_id: str | None,
) -> ProviderResponse:
    name = validate_name(data.name)
    alias = validate_alias(data.aliases)
    base_url = normalize_base_url(data.base_url)
    protocol = validate_protocol(data.protocol)
    custom_header = _normalize_custom_header(data.custom_header)

    _ensure_alias_available(db, alias)

    provider = Provider(
        name=name,
        aliases=alias,
        base_url=base_url,
        api_key=encrypt_secret(data.api_key or ""),
        custom_header=(
            encrypt_secret(custom_header) if custom_header is not None else None
        ),
        protocol=protocol,
        is_enabled=True,
    )

    db.add(provider)
    db.flush()

    if data.initial_credits is not None:
        from backend.credits.calculation import to_microcredits
        from backend.credits.models import CreditEntry, ProviderCredits

        amount = to_microcredits(data.initial_credits)
        db.add(ProviderCredits(provider_id=provider.id, remaining=amount, reserved=0))
        db.add(
            CreditEntry(
                owner_type="provider",
                owner_id=provider.id,
                amount=amount,
                remaining_after=amount,
                actor_id=actor_id,
                idempotency_key=f"initial:{provider.id}",
                reason="Initial provider credits",
            )
        )

    _audit(
        db,
        provider_id=provider.id,
        actor_id=actor_id,
        action="create",
        details={
            "name": provider.name,
            "aliases": provider.aliases,
            "protocol": provider.protocol,
        },
    )

    _commit(db, "Provider alias already exists")
    db.refresh(provider)

    return to_provider_response(provider)


def update_provider(
    db: Session,
    provider_id: str,
    data: ProviderUpdateRequest,
    *,
    actor_id: str | None,
) -> ProviderResponse:
    provider = get_provider_or_404(db, provider_id)
    supplied = data.model_fields_set
    details: dict[str, Any] = {}

    if "name" in supplied and data.name is not None:
        name = validate_name(data.name)

        if name != provider.name:
            details["name"] = {"from": provider.name, "to": name}
            provider.name = name

    if "aliases" in supplied and data.aliases is not None:
        alias = validate_alias(data.aliases)

        if alias != provider.aliases:
            _ensure_alias_available(db, alias, exclude_provider_id=provider.id)

            old_alias = provider.aliases
            provider.aliases = alias

            # Regenerate public model IDs in the same transaction as the alias
            # change so no request can observe a stale prefix.
            models = (
                db.query(ProviderModel)
                .filter(ProviderModel.provider_id == provider.id)
                .all()
            )

            for model in models:
                model.model_id = build_model_id(alias, model.model_name)

            details["aliases"] = {"from": old_alias, "to": alias}
            details["models_regenerated"] = len(models)

    if "base_url" in supplied and data.base_url is not None:
        base_url = normalize_base_url(data.base_url)

        if base_url != provider.base_url:
            details["base_url"] = {"from": provider.base_url, "to": base_url}
            provider.base_url = base_url

    if "protocol" in supplied and data.protocol is not None:
        protocol = validate_protocol(data.protocol)

        if protocol != provider.protocol:
            details["protocol"] = {"from": provider.protocol, "to": protocol}
            provider.protocol = protocol

    if "api_key" in supplied and data.api_key is not None:
        # An omitted field never overwrites the stored key. Sending an empty
        # string explicitly clears it.
        provider.api_key = encrypt_secret(data.api_key)
        details["api_key"] = "cleared" if not data.api_key else "updated"

    if "custom_header" in supplied:
        if data.custom_header is None:
            provider.custom_header = None
            details["custom_header"] = "cleared"
        else:
            custom_header = _normalize_custom_header(data.custom_header)
            provider.custom_header = (
                encrypt_secret(custom_header) if custom_header is not None else None
            )
            details["custom_header"] = "cleared" if custom_header is None else "updated"

    if "is_enabled" in supplied and data.is_enabled is not None:
        if data.is_enabled != provider.is_enabled:
            details["is_enabled"] = {
                "from": provider.is_enabled,
                "to": data.is_enabled,
            }
            provider.is_enabled = data.is_enabled

    if details:
        _audit(
            db,
            provider_id=provider.id,
            actor_id=actor_id,
            action="update",
            details=details,
        )

    _commit(db, "Provider alias already exists")
    db.refresh(provider)

    return to_provider_response(provider)


def delete_provider(
    db: Session,
    provider_id: str,
    *,
    actor_id: str | None,
) -> None:
    provider = get_provider_or_404(db, provider_id)

    from backend.credits.models import ModelCreditRate, ProviderCredits
    from backend.gateway.model_groups.models import ModelGroup, ModelGroupMember
    from backend.traces.models import LLMCallTrace

    has_rate = (
        db.query(ModelCreditRate)
        .join(
            ProviderModel,
            ModelCreditRate.provider_model_id == ProviderModel.id,
        )
        .filter(ProviderModel.provider_id == provider_id)
        .first()
    )
    if db.get(ProviderCredits, provider_id) is not None or has_rate is not None:
        raise HTTPException(
            409, "Provider has credit history or configured rates. Disable it instead."
        )

    # Check and clean up provider models
    models = (
        db.query(ProviderModel).filter(ProviderModel.provider_id == provider.id).all()
    )
    model_ids = [m.id for m in models]

    if model_ids:
        # Check if any model is actively used in model groups
        member = (
            db.query(ModelGroupMember)
            .filter(ModelGroupMember.provider_model_id.in_(model_ids))
            .first()
        )
        if member is not None:
            group = (
                db.query(ModelGroup)
                .filter(ModelGroup.id == member.model_group_id)
                .first()
            )
            group_name = group.name if group else member.model_group_id
            referenced_model = next(
                (m.model_id for m in models if m.id == member.provider_model_id),
                member.provider_model_id,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Provider model '{referenced_model}' is used in model group '{group_name}'. Remove it from the group first.",
            )

        # Check if any model has historical call traces
        trace = (
            db.query(LLMCallTrace)
            .filter(LLMCallTrace.provider_model_id.in_(model_ids))
            .first()
        )
        if trace is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Provider has historical call traces and cannot be deleted. Disable the provider instead.",
            )

        # Delete provider models cleanly
        for model in models:
            db.delete(model)
        db.flush()

    _audit(
        db,
        provider_id=provider.id,
        actor_id=actor_id,
        action="delete",
        details={
            "name": provider.name,
            "aliases": provider.aliases,
            "models": len(models),
        },
    )

    db.delete(provider)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Provider is referenced by other records and cannot be deleted: {exc}",
        ) from None


def disable_provider(
    db: Session,
    provider_id: str,
    *,
    actor_id: str | None,
) -> ProviderResponse:
    provider = get_provider_or_404(db, provider_id)

    if provider.is_enabled:
        provider.is_enabled = False
        _audit(
            db,
            provider_id=provider.id,
            actor_id=actor_id,
            action="disable",
            details={"is_enabled": {"from": True, "to": False}},
        )
        _commit(db, "Provider could not be disabled")
        db.refresh(provider)

    return to_provider_response(provider)


def seed_providers_from_settings() -> int:
    """Import legacy ``PROVIDERS`` settings once, when the registry is empty."""

    if not settings.PROVIDERS:
        return 0

    db = SessionLocal()

    try:
        if db.query(Provider).first():
            return 0

        created = 0
        seen_aliases: set[str] = set()

        for config in settings.PROVIDERS:
            try:
                alias = validate_alias(config.name)

                if alias in seen_aliases:
                    logger.warning("Skipping duplicate provider alias in settings: %s", alias)
                    continue

                base_url = normalize_base_url(config.base_url)
                protocol = validate_protocol(config.protocol)
                custom_headers = parse_custom_header(serialize_custom_header(config.headers))

                provider = Provider(
                    name=config.name.strip(),
                    aliases=alias,
                    base_url=base_url,
                    api_key=encrypt_secret(config.api_key),
                    custom_header=(
                        encrypt_secret(serialize_custom_header(custom_headers))
                        if custom_headers
                        else None
                    ),
                    protocol=protocol,
                    is_enabled=True,
                )
            except (HTTPException, CredentialError) as error:
                logger.warning("Skipping invalid provider in settings: %s", getattr(error, "detail", error))
                continue

            db.add(provider)
            seen_aliases.add(alias)
            created += 1

        db.commit()
        return created
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Gateway data plane
# ---------------------------------------------------------------------------

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _client

    if _client is None:
        _client = httpx.AsyncClient(timeout=settings.ROUTER_TIMEOUT)

    return _client


def build_headers(provider: RuntimeProvider) -> dict[str, str]:
    return build_provider_headers(
        provider.protocol,
        provider.api_key,
        provider.headers,
    )


def count_anthropic_input_tokens(
    provider: RuntimeProvider, model: str, payload: dict[str, Any]
) -> int | None:
    if provider.protocol != "anthropic" or provider.base_url not in (
        "https://api.anthropic.com",
        "https://api.anthropic.com/v1",
    ):
        return None

    count_payload = {
        key: payload[key]
        for key in (
            "messages", "system", "tools", "tool_choice", "thinking",
            "output_config", "cache_control", "speed",
        )
        if key in payload
    }
    count_payload["model"] = model
    try:
        response = httpx.post(
            provider_api_url(provider.base_url, "/messages/count_tokens"),
            headers=build_headers(provider),
            json=count_payload,
            timeout=2.0,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    count = data.get("input_tokens") if isinstance(data, dict) else None
    return count if type(count) is int and 0 < count <= 10_000_000 else None


_MAX_PROVIDER_ERROR_BYTES = 16 * 1024


def inference_endpoint(protocol: str) -> str:
    return "/messages" if protocol == "anthropic" else "/chat/completions"


def provider_error_body(response: httpx.Response, body: bytes | bytearray) -> str | None:
    if not body or len(body) > _MAX_PROVIDER_ERROR_BYTES:
        return None
    try:
        return body.decode(response.encoding or "utf-8", errors="replace")
    except (LookupError, UnicodeError):
        return body.decode("utf-8", errors="replace")


async def _read_provider_error(response: httpx.Response) -> str | None:
    """Read a small diagnostic body without delaying an upstream rejection indefinitely."""

    body = bytearray()
    try:
        async with asyncio.timeout(0.25):
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > _MAX_PROVIDER_ERROR_BYTES:
                    return None
                body.extend(chunk)
    except (TimeoutError, httpx.HTTPError):
        return None
    return provider_error_body(response, body)


async def call_provider(
    provider: RuntimeProvider,
    payload: dict[str, Any],
    stream: bool,
    *,
    capture_error: bool = False,
) -> httpx.Response:
    suffix = inference_endpoint(provider.protocol)

    try:
        url = provider_api_url(provider.base_url, suffix)
    except HTTPException:
        raise GatewayError(500, "configuration_error", "Provider base URL is invalid") from None

    try:
        request = get_client().build_request(
            "POST",
            url,
            headers=build_headers(provider),
            json=payload,
        )
        response = await get_client().send(request, stream=True)
        if response.status_code >= 400:
            try:
                body = await _read_provider_error(response) if capture_error else None
            finally:
                await response.aclose()
            raise GatewayError(
                response.status_code,
                "upstream_error",
                "Provider returned an error",
                provider_status=response.status_code,
                provider_response=body,
            )

        if not stream:
            try:
                await response.aread()
            finally:
                await response.aclose()
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.WriteError) as error:
        # Connection-stage failure: nothing reached the provider.
        raise GatewayError(
            502, "dispatch_failed", "Provider request could not be dispatched"
        ) from error
    except httpx.TimeoutException:
        raise GatewayError(504, "upstream_timeout", "Provider request timed out")
    except httpx.HTTPError:
        raise GatewayError(502, "upstream_error", "Provider request failed")

    return response


async def read_sse_data(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    buffer = ""
    event_name = ""

    try:
        async for raw_chunk in response.aiter_text():
            buffer += raw_chunk

            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.rstrip("\r")

                if line.startswith("event:"):
                    event_name = line.removeprefix("event:").strip()
                elif line.startswith("data:"):
                    data = line.removeprefix("data:").strip()

                    if data == "[DONE]":
                        yield {"done": True}
                        continue

                    if data:
                        try:
                            parsed = json.loads(data)
                        except json.JSONDecodeError:
                            continue

                        if isinstance(parsed, dict):
                            if event_name:
                                parsed["event"] = event_name
                            yield parsed
    finally:
        await response.aclose()
