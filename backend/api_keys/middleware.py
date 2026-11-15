import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend.api_keys.models import APIKey, APIKeyUsage
from backend.auth.models import User
from backend.core.database import SessionLocal
from backend.core.datetime_safety import to_utc


def _provider_error(path: str, status_code: int, code: str, message: str) -> JSONResponse:
    """Provider-shaped body; middleware errors are outside the exception
    handlers, so the /v1 wire contract is rebuilt here directly."""
    if path.startswith("/v1/messages"):
        return JSONResponse(
            status_code=status_code,
            content={
                "type": "error",
                "error": {"type": "invalid_request_error", "message": message},
            },
        )

    return JSONResponse(
        status_code=status_code,
        content={"error": {"message": message, "type": code, "param": None, "code": code}},
    )


class APIKeyAuthMiddleware(BaseHTTPMiddleware):
    """Authenticate inference calls with API keys only; keys never become JWT identities."""

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/v1/"):
            return await call_next(request)

        presented = request.headers.get("x-api-key")
        authorization = request.headers.get("authorization", "")
        if not presented and authorization.lower().startswith("bearer "):
            presented = authorization[7:].strip()
        if not presented:
            return _provider_error(
                request.url.path, 401, "authentication_error", "A valid API key is required"
            )

        db = SessionLocal()
        try:
            key_hash = hashlib.sha256(presented.encode()).hexdigest()
            key = db.query(APIKey).filter(APIKey.key_hash == key_hash).first()
            if key is None or key.revoked:
                return _provider_error(
                    request.url.path, 401, "authentication_error", "Invalid or revoked API key"
                )
            now = datetime.now(timezone.utc)
            if key.expires_at is not None and to_utc(key.expires_at) <= now:
                return _provider_error(
                    request.url.path, 401, "authentication_error", "API key has expired"
                )
            owner = (
                db.query(User)
                .filter(User.id == key.owner_id, User.is_active.is_(True))
                .first()
            )
            if owner is None:
                return _provider_error(
                    request.url.path, 401, "authentication_error", "Invalid or revoked API key"
                )
            cutoff = now - timedelta(minutes=1)
            count = (
                db.query(APIKeyUsage)
                .filter(APIKeyUsage.key_id == key.id, APIKeyUsage.used_at >= cutoff)
                .count()
            )
            if count >= 60:
                return _provider_error(
                    request.url.path, 429, "rate_limit_exceeded", "API key rate limit exceeded"
                )
            # Snapshot before commit; commit expires ORM attribute access.
            key_id, owner_id = key.id, key.owner_id
            tracing_enabled = bool(owner.tracing_enabled)
            telemetry_enabled = bool(owner.telemetry_enabled)
            key.last_used_at = now
            db.add(APIKeyUsage(key_id=key.id, used_at=now))
            db.commit()
        finally:
            db.close()
        request.state.api_key_id = key_id
        request.state.api_key_owner_id = owner_id
        # Tracing is opt-in per user; the capture layer reads this flag so a
        # disabled user's traffic never writes trace records.
        request.state.tracing_enabled = tracing_enabled
        # OpenTelemetry opt-out belongs to the key owner themselves; the
        # request middleware and the capture layer both read this flag.
        request.state.telemetry_enabled = telemetry_enabled
        return await call_next(request)
