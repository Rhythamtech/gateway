from typing import Any

from fastapi import APIRouter, Request

from backend.gateway.chat.models import (
    openai_stream_to_anthropic,
    openai_to_anthropic_response,
)
from backend.gateway.execution import dispatch_request
from backend.gateway.messages.dtos import AnthropicMessageRequest
from backend.gateway.streaming import sse
from backend.traces.capture import start_capture

router = APIRouter(prefix="/v1", tags=["Gateway"])


@router.post("/messages")
async def create_message(request: Request, data: AnthropicMessageRequest) -> Any:
    payload = data.model_dump(exclude_none=True)
    capture = start_capture(request, payload)
    execution, response = await dispatch_request(request, payload, capture, input_protocol="anthropic")

    if not payload.get("stream"):
        result = await execution.read_json()
        return (
            result
            if execution.provider.protocol == "anthropic"
            else openai_to_anthropic_response(result, payload["model"])
        )

    events = execution.stream_events()
    if execution.provider.protocol == "openai":
        pieces = openai_stream_to_anthropic(
            response, execution.candidate.upstream_model, events=events
        )
    else:

        async def stream_anthropic():
            async for event in events:
                if event.get("done"):
                    break
                event_type = event.get("type") or event.get("event")
                event.pop("event", None)
                yield sse(event, event_type)

        pieces = stream_anthropic()
    return execution.stream_response(pieces, anthropic=True)
