from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from backend.gateway.chat.dtos import ChatCompletionRequest
from backend.gateway.chat.models import (
    anthropic_stream_to_openai,
    anthropic_to_openai,
    anthropic_to_openai_response,
    openai_to_anthropic,
)
from backend.gateway.providers.service import (
    call_provider,
    get_provider,
    read_sse_data,
    resolve_model,
)
from backend.gateway.streaming import sse

router = APIRouter(prefix="/v1", tags=["Gateway"])


async def forward_chat(payload: dict[str, Any]) -> Any:
    provider_name, upstream_model = resolve_model(payload["model"])
    provider = get_provider(provider_name)
    stream = payload.get("stream", False)

    upstream_payload = dict(payload)
    upstream_payload["model"] = upstream_model

    if provider.protocol == "anthropic":
        upstream_payload = openai_to_anthropic(upstream_payload)

    upstream_response = await call_provider(provider_name, upstream_payload, stream)

    if not stream:
        data = upstream_response.json()

        if provider.protocol == "anthropic":
            return anthropic_to_openai_response(data)

        return data

    if provider.protocol == "openai":
        async def stream_openai():
            async for event in read_sse_data(upstream_response):
                if event.get("done"):
                    yield "data: [DONE]\n\n"
                else:
                    event.pop("event", None)
                    yield sse(event)

        return StreamingResponse(stream_openai(), media_type="text/event-stream")

    async def stream_anthropic():
        async for piece in anthropic_stream_to_openai(upstream_response, upstream_model):
            yield piece

    return StreamingResponse(stream_anthropic(), media_type="text/event-stream")


@router.post("/chat/completions")
async def create_chat_completion(data: ChatCompletionRequest) -> Any:
    return await forward_chat(data.model_dump())
