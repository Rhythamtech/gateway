import uuid
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from backend.core.errors import GatewayError
from backend.gateway.chat.models import anthropic_to_openai_response, openai_to_anthropic
from backend.gateway.providers.service import (
    call_provider,
    get_provider,
    read_sse_data,
    resolve_model,
)
from backend.gateway.responses.dtos import ResponsesRequest
from backend.gateway.responses.models import chat_to_responses, responses_to_chat
from backend.gateway.streaming import sse
from backend.traces.capture import monitor_stream, start_capture

router = APIRouter(prefix="/v1", tags=["Gateway"])


@router.post("/responses")
async def create_response(request: Request, data: ResponsesRequest) -> Any:
    payload = data.model_dump()

    for key in ("previous_response_id", "background", "conversation"):
        if payload.get(key):
            raise GatewayError(400, "unsupported_parameter", f"{key} is not supported")

    chat_payload = responses_to_chat(payload)
    stream = chat_payload.get("stream", False)

    capture = start_capture(request, payload)

    try:
        provider_name, upstream_model = resolve_model(chat_payload["model"])
        provider = get_provider(provider_name)
    except GatewayError as exc:
        capture.failure(exc)
        raise

    capture.attempt(
        provider_name,
        upstream_model,
        chat_payload.get("model"),
        protocol=provider.protocol,
        stream=stream,
    )

    chat_payload["model"] = upstream_model

    if provider.protocol == "anthropic":
        upstream_payload = openai_to_anthropic(chat_payload)
    else:
        upstream_payload = chat_payload

    try:
        upstream_response = await call_provider(provider_name, upstream_payload, stream)
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
            data = anthropic_to_openai_response(data)

        return JSONResponse(content=chat_to_responses(data, payload))

    events = monitor_stream(read_sse_data(upstream_response), capture, protocol=provider.protocol)

    async def stream_response():
        response_id = f"resp_{uuid.uuid4().hex[:24]}"
        output_index = -1
        text_started = False
        tool_calls: dict[int, dict[str, Any]] = {}

        yield sse({
            "type": "response.created",
            "response": {
                "id": response_id,
                "object": "response",
                "status": "in_progress",
                "model": payload["model"],
                "output": [],
            },
        }, "response.created")

        async for chunk in events:
            if chunk.get("done"):
                break

            choice = chunk.get("choices", [{}])[0]
            delta = choice.get("delta", {}) or {}

            if delta.get("content"):
                if not text_started:
                    output_index += 1
                    text_started = True

                yield sse({
                    "type": "response.output_text.delta",
                    "output_index": output_index,
                    "delta": delta["content"],
                }, "response.output_text.delta")

            for tool_call in delta.get("tool_calls") or []:
                index = tool_call.get("index", 0)
                function = tool_call.get("function", {}) or {}

                if index not in tool_calls:
                    output_index += 1
                    tool_calls[index] = {
                        "output_index": output_index,
                        "call_id": tool_call.get("id", f"call_{uuid.uuid4().hex[:24]}"),
                        "name": function.get("name", ""),
                        "arguments": "",
                    }

                if function.get("arguments"):
                    tool_calls[index]["arguments"] += function["arguments"]

        output = []

        if text_started:
            output.append({
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": "", "annotations": []}],
            })

        for tool_call in tool_calls.values():
            output.append({
                "type": "function_call",
                "call_id": tool_call["call_id"],
                "name": tool_call["name"],
                "arguments": tool_call["arguments"],
                "status": "completed",
            })

        yield sse({
            "type": "response.completed",
            "response": {
                "id": response_id,
                "object": "response",
                "status": "completed",
                "model": payload["model"],
                "output": output,
            },
        }, "response.completed")

    return StreamingResponse(stream_response(), media_type="text/event-stream")
