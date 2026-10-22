import logging

import fastapi
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class GatewayError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def openai_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "message": message,
                "type": code,
                "param": None,
                "code": code,
            }
        },
    )


def anthropic_error(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "type": "error",
            "error": {"type": "invalid_request_error", "message": message},
        },
    )


def shaped_error(
    path: str,
    status_code: int,
    code: str,
    message: str,
) -> JSONResponse:
    if path.startswith("/v1/messages"):
        return anthropic_error(status_code, message)

    if path.startswith("/v1/"):
        return openai_error(status_code, code, message)

    return JSONResponse(status_code=status_code, content={"detail": message})


async def handle_gateway_error(
    request: fastapi.Request,
    error: GatewayError,
) -> JSONResponse:
    return shaped_error(request.url.path, error.status_code, error.code, error.message)


async def handle_validation_error(
    request: fastapi.Request,
    error: RequestValidationError,
) -> JSONResponse:
    if request.url.path.startswith("/provider"):
        # Provider-management requests use 400 for malformed input.
        return JSONResponse(
            status_code=400,
            content={"detail": jsonable_encoder(error.errors())},
        )

    if not request.url.path.startswith("/v1/"):
        return JSONResponse(
            status_code=422,
            content={"detail": jsonable_encoder(error.errors())},
        )

    message = "; ".join(
        f"{'.'.join(str(part) for part in item.get('loc', ()))}: {item.get('msg', 'invalid value')}"
        for item in error.errors()
    )

    return shaped_error(
        request.url.path,
        422,
        "invalid_request_error",
        message or "Invalid request",
    )


async def handle_unexpected_error(
    request: fastapi.Request,
    error: Exception,
) -> JSONResponse:
    logger.exception("Unhandled error for %s %s", request.method, request.url.path)
    return shaped_error(request.url.path, 500, "internal_error", "Internal server error")
