from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from backend.gateway.chat.models import (
    anthropic_to_openai,
    anthropic_stream_to_openai,
    openai_to_anthropic,
    openai_to_anthropic_response,
    openai_stream_to_anthropic,
)
from backend.gateway.messages.dtos import AnthropicMessageRequest
from backend.gateway.providers.service import (
    call_provider,
    get_provider,
    read_sse_data,
    resolve_model,
)
from backend.gateway.streaming import sse

router = APIRouter(prefix="/v1", tags=["Gateway"])


# NOTE: /v1/* is currently unauthenticated. Planned: users generate per-user API
# keys and present them as `Authorization: Bearer <key>`; validate against the
# users table before these routes go public.
@router.post("/messages")
async def create_message(data: AnthropicMessageRequest) -> Any:
    payload = data.model_dump()

    provider_name, upstream_model = resolve_model(payload["model"])
    provider = get_provider(provider_name)
    stream = payload.get("stream", False)

    if provider.protocol == "anthropic":
        upstream_payload = dict(payload)
        upstream_payload["model"] = upstream_model
    else:
        upstream_payload = anthropic_to_openai(payload)
        upstream_payload["model"] = upstream_model

    upstream_response = await call_provider(provider_name, upstream_payload, stream)

    if not stream:
        data = upstream_response.json()

        if provider.protocol == "anthropic":
            return JSONResponse(content=data)

        return JSONResponse(
            content=openai_to_anthropic_response(data, payload["model"]),
        )

    if provider.protocol == "anthropic":
        async def stream_anthropic():
            async for event in read_sse_data(upstream_response):
                if event.get("done"):
                    break
                event_type = event.get("type") or event.get("event")
                event.pop("event", None)
                yield sse(event, event_type)

        return StreamingResponse(stream_anthropic(), media_type="text/event-stream")

    async def stream_openai_as_anthropic():
        async for piece in openai_stream_to_anthropic(upstream_response, upstream_model):
            yield piece

    return StreamingResponse(stream_openai_as_anthropic(), media_type="text/event-stream")
