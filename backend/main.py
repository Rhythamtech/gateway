import logging
import asyncio
import sys
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.auth.controller import router as auth_router
from backend.auth.models import User
from backend.api_keys import models as api_key_models  # noqa: F401
from backend.api_keys.controller import router as api_keys_router
from backend.api_keys.middleware import APIKeyAuthMiddleware
from backend.core.database import Base, write_engine
from backend.core.errors import GatewayError
from backend.coupons import models as coupon_models  # noqa: F401
from backend.coupons.controller import router as coupons_router
from backend.credits.controller import router as credits_router
from backend.credits.models import CreditUsage as CreditUsage
from backend.credits.reconciliation import reconcile_credits
from backend.core.migrations import run_pending_migrations
from backend.support import models as support_models  # noqa: F401
from backend.support.controller import router as support_router
from backend.gateway.chat.controller import router as chat_router
from backend.gateway.messages.controller import router as messages_router
from backend.gateway.model_groups import models as model_group_models  # noqa: F401
from backend.gateway.model_groups.controller import router as model_groups_router
from backend.gateway.provider_models.controller import (
    gateway_router as models_gateway_router,
)
from backend.gateway.provider_models.controller import router as provider_models_router
from backend.gateway.providers.controller import router as providers_router
from backend.gateway.providers.service import seed_providers_from_settings
from backend.gateway.responses.controller import router as responses_router
from backend.telemetry import TelemetryMiddleware
from backend.telemetry import setup as setup_telemetry, shutdown as shutdown_telemetry
from backend.traces import models as trace_models  # noqa: F401
from backend.traces.controller import router as traces_router
from backend.traces.service import purge_expired_logs
from backend.users.controller import router as users_router
from backend.users import audit as user_audit_models  # noqa: F401

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # OpenTelemetry span recording (see docs/tracing.md).
    setup_telemetry(app)

    seeded = seed_providers_from_settings()

    if seeded:
        logger.info("Imported %s provider(s) from configuration", seeded)

    reconciliation_task = asyncio.create_task(reconcile_credits())
    async def retention_loop():
        while True:
            await asyncio.to_thread(purge_expired_logs)
            await asyncio.sleep(3600)

    retention_task = asyncio.create_task(retention_loop())
    try:
        yield
    finally:
        retention_task.cancel()
        with suppress(asyncio.CancelledError):
            await retention_task
        reconciliation_task.cancel()
        with suppress(asyncio.CancelledError):
            await reconciliation_task
        shutdown_telemetry()


Base.metadata.create_all(bind=write_engine)

# Schema migrations run at import time (not only under the server lifespan)
# so scripts, tests and short-lived processes always observe the current
# schema; every migration is idempotent against freshly created tables.
run_pending_migrations(write_engine)

app = FastAPI(
    title="Gateway API",
    description="LLM gateway for managing providers, models, and API keys.",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)
# Ordering note: the LAST-added middleware runs first (outermost). CORS is
# outermost; APIKeyAuth runs next and TelemetryMiddleware runs after it, so
# an authenticated /v1 request already carries telemetry_enabled state.
app.add_middleware(TelemetryMiddleware)
app.add_middleware(APIKeyAuthMiddleware)

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(api_keys_router)
app.include_router(users_router)
app.include_router(model_groups_router)
app.include_router(chat_router)
app.include_router(messages_router)
app.include_router(responses_router)
app.include_router(models_gateway_router)
app.include_router(providers_router)
app.include_router(provider_models_router)
app.include_router(traces_router)
app.include_router(credits_router)
app.include_router(coupons_router)
app.include_router(support_router)


# ---------------------------------------------------------------------------
# Error shaping by request path
#
# Raises are always ``fastapi.HTTPException`` (+ ``status`` constants); this
# composition root rebuilds each response body from ``exc.detail`` so the
# wire contract is preserved:
#
# * ``/v1/*``        — OpenAI ``{"error": {"message", "type", "code"}}`` SDK
#   clients parse; ``/v1/messages`` uses the Anthropic error envelope.
# * ``/model-groups*`` — versioned ``{"error": {"code", "message", ...}}``.
# * everything else  — FastAPI's default ``{"detail": ...}``.
# ---------------------------------------------------------------------------

_MODEL_GROUP_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "UNPROCESSABLE_ENTITY",
    500: "INTERNAL_ERROR",
}

_OPENAI_CODES = {
    401: "authentication_error",
    404: "not_found_error",
    429: "rate_limit_exceeded",
}

# Fallbacks for /traces when a raise carries no code; all versioned raises in
# the traces controller carry their own code.
_TRACE_CODES = {
    400: "INVALID_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "TRACE_NOT_FOUND",
    500: "INTERNAL_ERROR",
}


def _is_model_group_path(path: str) -> bool:
    return path == "/model-groups" or path.startswith("/model-groups/")


def _is_traces_path(path: str) -> bool:
    return path.startswith("/traces")


def _versioned_error(
    status_code: int,
    code: str,
    message: str,
    details: dict | None = None,
) -> JSONResponse:
    """Versioned envelope shared by /model-groups and /traces error contracts."""
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
                "request_id": str(uuid4()),
            }
        },
    )


def _openai_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {"message": message, "type": code, "param": None, "code": code}
        },
    )


def _anthropic_error(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "type": "error",
            "error": {"type": "invalid_request_error", "message": message},
        },
    )


def _error_parts(error: HTTPException) -> tuple[str | None, str, dict]:
    """Extract (code, message, details) from an HTTPException's detail."""

    if isinstance(error.detail, dict):
        return (
            error.detail.get("code"),
            error.detail.get("message", "Request failed."),
            error.detail.get("details", {}),
        )

    message = error.detail if isinstance(error.detail, str) else "Request failed."
    return None, message, {}


def _openai_fallback_code(status_code: int) -> str:
    code = _OPENAI_CODES.get(status_code)
    if code:
        return code
    return "internal_error" if status_code >= 500 else "invalid_request_error"


async def handle_gateway_error(request: Request, error: GatewayError) -> JSONResponse:
    if _is_model_group_path(request.url.path):
        return _versioned_error(
            error.status_code,
            error.code.upper(),
            error.message,
        )

    if request.url.path.startswith("/v1/messages"):
        return _anthropic_error(error.status_code, error.message)

    if request.url.path.startswith("/v1/"):
        return _openai_error(error.status_code, error.code, error.message)

    return JSONResponse(
        status_code=error.status_code,
        content={"detail": error.message},
    )


async def handle_http_error(request: Request, error: HTTPException) -> JSONResponse:
    code, message, details = _error_parts(error)

    if _is_model_group_path(request.url.path):
        return _versioned_error(
            error.status_code,
            code or _MODEL_GROUP_CODES.get(error.status_code, "REQUEST_ERROR"),
            message,
            details,
        )

    if _is_traces_path(request.url.path):
        return _versioned_error(
            error.status_code,
            code or _TRACE_CODES.get(error.status_code, "TRACE_ERROR"),
            message,
            details,
        )

    if request.url.path.startswith("/v1/messages"):
        return _anthropic_error(error.status_code, message)

    if request.url.path.startswith("/v1/"):
        return _openai_error(
            error.status_code,
            code or _openai_fallback_code(error.status_code),
            message,
        )

    return JSONResponse(
        status_code=error.status_code,
        content={"detail": error.detail},
        headers=error.headers,
    )


async def handle_validation_error(
    request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    message = "; ".join(
        f"{'.'.join(str(part) for part in item.get('loc', ()))}: {item.get('msg', 'invalid value')}"
        for item in error.errors()
    )

    if _is_model_group_path(request.url.path):
        return _versioned_error(
            status.HTTP_400_BAD_REQUEST, "MALFORMED_INPUT", message or "Malformed request."
        )

    if _is_traces_path(request.url.path):
        return _versioned_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "MALFORMED_INPUT", message or "Malformed request."
        )

    if request.url.path.startswith("/provider"):
        # Provider-management requests use 400 for malformed input.
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"detail": jsonable_encoder(error.errors())},
        )

    if not request.url.path.startswith("/v1/"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": jsonable_encoder(error.errors())},
        )

    if request.url.path.startswith("/v1/messages"):
        return _anthropic_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, message or "Invalid request"
        )

    return _openai_error(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "invalid_request_error",
        message or "Invalid request",
    )


async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception("Unhandled error for %s %s", request.method, request.url.path)

    if _is_model_group_path(request.url.path):
        return _versioned_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Internal server error.",
        )

    if _is_traces_path(request.url.path):
        return _versioned_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Internal server error.",
        )

    if request.url.path.startswith("/v1/messages"):
        return _anthropic_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Internal server error"
        )

    if request.url.path.startswith("/v1/"):
        return _openai_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal server error",
        )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


app.add_exception_handler(GatewayError, handle_gateway_error)
app.add_exception_handler(RequestValidationError, handle_validation_error)
app.add_exception_handler(Exception, handle_unexpected_error)
app.add_exception_handler(HTTPException, handle_http_error)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "logo.png", media_type="image/png")


@app.get("/redoc", include_in_schema=False)
async def redoc() -> HTMLResponse:
    return get_redoc_html(
        openapi_url=app.openapi_url,
        title=f"{app.title} — Documentation",
        redoc_favicon_url="/static/logo.png",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
