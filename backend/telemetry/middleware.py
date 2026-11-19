"""Request-level telemetry middleware.

Runs **inside** ``APIKeyAuthMiddleware`` (telemetry middleware is registered
before it in ``backend.main``, and the last-added middleware runs first), so
by dispatch time an authenticated ``/v1`` request already carries
``request.state.telemetry_enabled``. Consequence of honoring it here:

* an opted-out user's inference traffic produces **no** request span and —
  via ``backend.traces.capture`` — **no** LLM-call span,
* operator traffic (auth/admin routes, never stamped) falls back to the
  global ``TELEMETRY_ENABLED`` switch.
"""

from typing import Any

from fastapi import Request
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware

from backend.telemetry import service
from backend.telemetry.service import finish_request_span, start_request_span


class TelemetryMiddleware(BaseHTTPMiddleware):
    """Decision gate for OTel request spans; never mutates the request."""

    async def dispatch(self, request: Request, call_next) -> Response:
        if not service.spans_active():
            return await call_next(request)

        # None for routes that never pass through API-key auth: operator
        # traffic follows the global switch, not a user preference.
        opted = getattr(request.state, "telemetry_enabled", None)

        if opted is False:
            return await call_next(request)

        span = start_request_span(
            method=request.method,
            path=request.url.path,
            authenticated=bool(opted),
        )
        auth_latency = getattr(request.state, "auth_latency_ms", None)
        if span is not None and auth_latency is not None:
            span.set_attribute("gateway.auth_latency_ms", auth_latency)
        try:
            response = await call_next(request)
        except Exception as error:
            finish_request_span(span, error=error)
            raise

        finish_request_span(span, status_code=response.status_code)
        return response
