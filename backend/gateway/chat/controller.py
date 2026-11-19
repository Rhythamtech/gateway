from starlette.concurrency import run_in_threadpool
from typing import Any

from fastapi import APIRouter, Request

from backend.core.errors import GatewayError
from backend.gateway.chat.dtos import ChatCompletionRequest
from backend.gateway.chat.models import (
    anthropic_stream_to_openai,
    anthropic_to_openai_response,
    openai_to_anthropic,
)
from backend.gateway.execution import admit_request
from backend.gateway.streaming import sse
from backend.traces.capture import start_capture

router = APIRouter(prefix="/v1", tags=["Gateway"])


async def forward_chat(request: Request, payload: dict[str, Any]) -> Any:
    capture = start_capture(request, payload)
    try:
        execution = await run_in_threadpool(admit_request, request, payload, capture)
    except GatewayError as exc:
        await run_in_threadpool(capture.failure, exc)
        raise

    upstream_payload = execution.payload
    upstream_payload["model"] = execution.candidate.upstream_model
    if execution.provider.protocol == "anthropic":
        upstream_payload = openai_to_anthropic(upstream_payload)
    response = await execution.send(upstream_payload)

    if not payload.get("stream"):
        data = await execution.read_json()
        return (
            anthropic_to_openai_response(data)
            if execution.provider.protocol == "anthropic"
            else data
        )

    events = execution.stream_events()
    if execution.provider.protocol == "anthropic":
        pieces = anthropic_stream_to_openai(
            response, execution.candidate.upstream_model, events=events
        )
    else:

        async def stream_openai():
            async for event in events:
                if event.get("done"):
                    yield "data: [DONE]\n\n"
                else:
                    event.pop("event", None)
                    yield sse(event)

        pieces = stream_openai()
    return execution.stream_response(pieces)


@router.post("/chat/completions")
async def create_chat_completion(request: Request, data: ChatCompletionRequest) -> Any:
    return await forward_chat(request, data.model_dump(exclude_none=True))
