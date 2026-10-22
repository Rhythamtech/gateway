import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.auth.controller import router as auth_router
from backend.auth.models import User
from backend.api_keys import models as api_key_models  # noqa: F401
from backend.api_keys.controller import router as api_keys_router
from backend.api_keys.middleware import APIKeyAuthMiddleware
from backend.core.database import Base, engine
from backend.core.errors import (
    GatewayError,
    handle_gateway_error,
    handle_http_error,
    handle_unexpected_error,
    handle_validation_error,
)
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
from backend.users.controller import router as users_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    seeded = seed_providers_from_settings()

    if seeded:
        logger.info("Imported %s provider(s) from configuration", seeded)

    yield


Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Gateway API",
    description="LLM gateway for managing providers, models, and API keys.",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)
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


@app.get("/docs", include_in_schema=False)
async def swagger_ui() -> HTMLResponse:
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=f"{app.title} — Documentation",
        swagger_favicon_url="/static/logo.png",
    )


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
