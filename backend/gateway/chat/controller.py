from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from backend.core.errors import GatewayError
from backend.gateway.chat.dtos import ChatCompletionRequest
from backend.gateway.chat.models import (
    anthropic_stream_to_openai,
    anthropic_to_openai_response,
    openai_to_anthropic,
)
from backend.gateway.providers.service import call_provider, read_sse_data
from backend.gateway.routing import plan
from backend.gateway.streaming import sse
from backend.traces.capture import monitor_stream, start_capture

router = APIRouter(prefix="/v1", tags=["Gateway"])


async def forward_chat(request: Request, payload: dict[str, Any]) -> Any:
    stream = payload.get("stream", False)

    capture = start_capture(request, payload)

    try:
        candidates = plan(payload["model"])
    except GatewayError as exc:
        capture.failure(exc)
        raise

    provider = None
    for candidate in candidates:
        try:
            # Resolves the runtime provider and validates that it can serve
            # this request before dispatch. Provider errors abort dispatch.
            provider = capture.begin_attempt(candidate, payload, stream=stream)
            break
        except GatewayError as exc:
            capture.failure(exc)
            raise
    else:
        raise GatewayError(503, "no_available_member", "No available member can serve this request")

    upstream_payload = dict(payload)
    upstream_payload["model"] = candidate.upstream_model

    if provider.protocol == "anthropic":
        upstream_payload = openai_to_anthropic(upstream_payload)

    try:
        upstream_response = await call_provider(candidate.provider_alias, upstream_payload, stream)
    except GatewayError as exc:
        capture.failure(exc)
        raise

    if not stream:
        try:
            data = upstream_response.json()
        except Exception as exc:  # noqa: BLE001 - malformed upstream bodies
            capture.failure(
                GatewayError(502, "upstream_error", "Provider returned an invalid response")
            )
            raise

        capture.success(data, protocol=provider.protocol)

        if provider.protocol == "anthropic":
            return anthropic_to_openai_response(data)

        return data

    # Usage comes from raw upstream chunks; converted streams are latency-only.
    if provider.protocol == "openai":
        events = monitor_stream(read_sse_data(upstream_response), capture, protocol="openai")

        async def stream_openai():
            async for event in events:
                if event.get("done"):
                    yield "data: [DONE]\n\n"
                else:
                    event.pop("event", None)
                    yield sse(event)

        return StreamingResponse(stream_openai(), media_type="text/event-stream")

    pieces = monitor_stream(
        anthropic_stream_to_openai(upstream_response, candidate.upstream_model),
        capture,
    )

    return StreamingResponse(pieces, media_type="text/event-stream")


@router.post("/chat/completions")
async def create_chat_completion(request: Request, data: ChatCompletionRequest) -> Any:
    return await forward_chat(request, data.model_dump())
