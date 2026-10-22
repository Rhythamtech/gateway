import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend.api_keys.models import APIKey, APIKeyUsage
from backend.auth.models import User
from backend.core.database import SessionLocal
from backend.core.errors import shaped_error


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
            return shaped_error(request.url.path, 401, "authentication_error", "A valid API key is required")

        db = SessionLocal()
        try:
            key = db.query(APIKey).filter(APIKey.key_hash == hashlib.sha256(presented.encode()).hexdigest()).first()
            if key is None or key.revoked:
                return shaped_error(request.url.path, 401, "authentication_error", "Invalid or revoked API key")
            owner = db.query(User).filter(User.id == key.owner_id, User.is_active.is_(True)).first()
            if owner is None:
                return shaped_error(request.url.path, 401, "authentication_error", "Invalid or revoked API key")
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(minutes=1)
            count = db.query(APIKeyUsage).filter(APIKeyUsage.key_id == key.id, APIKeyUsage.used_at >= cutoff).count()
            if count >= 60:
                return shaped_error(request.url.path, 429, "rate_limit_exceeded", "API key rate limit exceeded")
            key.last_used_at = now
            db.add(APIKeyUsage(key_id=key.id, used_at=now))
            key_id, owner_id = key.id, key.owner_id
            db.commit()
        finally:
            db.close()
        request.state.api_key_id = key_id
        request.state.api_key_owner_id = owner_id
        return await call_next(request)
