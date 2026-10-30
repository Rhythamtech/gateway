from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from backend.core.errors import GatewayError
from backend.gateway.chat.models import (
    anthropic_to_openai,
    openai_to_anthropic_response,
    openai_stream_to_anthropic,
)
from backend.gateway.messages.dtos import AnthropicMessageRequest
from backend.gateway.providers.service import call_provider, read_sse_data
from backend.gateway.routing import plan
from backend.gateway.streaming import sse
from backend.traces.capture import monitor_stream, start_capture
from backend.wallet.service import (
    NoAvailableMemberError,
    ProviderBudgetInsufficientError,
    ProviderCapacityInsufficientError,
)

router = APIRouter(prefix="/v1", tags=["Gateway"])


@router.post("/messages")
async def create_message(request: Request, data: AnthropicMessageRequest) -> Any:
    payload = data.model_dump()
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
            # Resolves the runtime provider, validates wallet/availability
            # and reserves credits plus provider budget before dispatch.
            # Budget-hold failures skip to the next member per the routing
            # strategy; other errors are recorded and abort the request.
            provider = capture.begin_attempt(candidate, payload, stream=stream)
            break
        except (ProviderBudgetInsufficientError, ProviderCapacityInsufficientError):
            continue  # skip to the next member per the routing strategy
        except GatewayError as exc:
            capture.failure(exc)
            raise
    else:
        capture.failure(
            GatewayError(
                429,
                "no_available_member",
                "No available member can serve this request within "
                "wallet, provider budget, and provider capacity limits",
            )
        )
        raise NoAvailableMemberError()

    if provider.protocol == "anthropic":
        upstream_payload = dict(payload)
        upstream_payload["model"] = candidate.upstream_model
    else:
        upstream_payload = anthropic_to_openai(payload)
        upstream_payload["model"] = candidate.upstream_model

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
            return JSONResponse(content=data)

        return JSONResponse(
            content=openai_to_anthropic_response(data, payload["model"]),
        )

    # Usage comes from raw upstream events; converted streams are latency-only.
    if provider.protocol == "anthropic":
        events = monitor_stream(read_sse_data(upstream_response), capture, protocol="anthropic")

        async def stream_anthropic():
            async for event in events:
                if event.get("done"):
                    break
                event_type = event.get("type") or event.get("event")
                event.pop("event", None)
                yield sse(event, event_type)

        return StreamingResponse(stream_anthropic(), media_type="text/event-stream")

    pieces = monitor_stream(
        openai_stream_to_anthropic(upstream_response, candidate.upstream_model),
        capture,
    )

    return StreamingResponse(pieces, media_type="text/event-stream")
