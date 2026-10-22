import logging
from uuid import uuid4

import fastapi
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


def model_group_error(
    status_code: int,
    code: str,
    message: str,
    details: dict | None = None,
) -> JSONResponse:
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


def _is_model_group_path(path: str) -> bool:
    return path == "/model-groups" or path.startswith("/model-groups/")


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
    if _is_model_group_path(request.url.path):
        return model_group_error(error.status_code, error.code.upper(), error.message)
    return shaped_error(request.url.path, error.status_code, error.code, error.message)


async def handle_validation_error(
    request: fastapi.Request,
    error: RequestValidationError,
) -> JSONResponse:
    if _is_model_group_path(request.url.path):
        message = "; ".join(
            f"{'.'.join(str(part) for part in item.get('loc', ()))}: {item.get('msg', 'invalid value')}"
            for item in error.errors()
        )
        return model_group_error(400, "MALFORMED_INPUT", message or "Malformed request.")

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
    if _is_model_group_path(request.url.path):
        return model_group_error(500, "INTERNAL_ERROR", "Internal server error.")
    return shaped_error(request.url.path, 500, "internal_error", "Internal server error")


async def handle_http_error(request: fastapi.Request, error: fastapi.HTTPException) -> JSONResponse:
    if not _is_model_group_path(request.url.path):
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": error.detail},
            headers=error.headers,
        )

    codes = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "UNPROCESSABLE_ENTITY",
    }
    if isinstance(error.detail, dict):
        code = error.detail.get("code", codes.get(error.status_code, "REQUEST_ERROR"))
        message = error.detail.get("message", "Request failed.")
        details = error.detail.get("details", {})
    else:
        code = codes.get(error.status_code, "REQUEST_ERROR")
        message = error.detail if isinstance(error.detail, str) else "Request failed."
        details = {}
    return model_group_error(error.status_code, code, message, details)
