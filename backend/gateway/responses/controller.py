import json
import uuid
from typing import Any

from fastapi import APIRouter, Request

from backend.core.errors import GatewayError
from backend.gateway.chat.models import (
    anthropic_stream_to_openai,
    anthropic_to_openai_response,
    openai_to_anthropic,
)
from backend.gateway.execution import admit_request, validate_credit_request
from backend.gateway.responses.dtos import ResponsesRequest
from backend.gateway.responses.models import chat_to_responses, responses_to_chat
from backend.gateway.streaming import sse
from backend.traces.capture import start_capture

router = APIRouter(prefix="/v1", tags=["Gateway"])


@router.post("/responses")
async def create_response(request: Request, data: ResponsesRequest) -> Any:
    payload = data.model_dump(exclude_none=True)

    for key in ("previous_response_id", "background", "conversation"):
        if payload.get(key):
            raise GatewayError(400, "unsupported_parameter", f"{key} is not supported")

    validate_credit_request(payload)
    chat_payload = responses_to_chat(payload)
    capture = start_capture(request, payload)
    try:
        execution = admit_request(request, chat_payload, capture)
    except GatewayError as exc:
        capture.failure(exc)
        raise

    upstream_payload = execution.payload
    upstream_payload["model"] = execution.candidate.upstream_model
    if execution.provider.protocol == "anthropic":
        upstream_payload = openai_to_anthropic(upstream_payload)
    response = await execution.send(upstream_payload)

    if not payload.get("stream"):
        result = await execution.read_json()
        if execution.provider.protocol == "anthropic":
            result = anthropic_to_openai_response(result)
        return chat_to_responses(result, payload)

    events = execution.stream_events()
    if execution.provider.protocol == "anthropic":
        events = anthropic_stream_to_openai(
            response, execution.candidate.upstream_model, events=events
        )

    async def stream_response():
        response_id = f"resp_{uuid.uuid4().hex[:24]}"
        output_index = -1
        text_started = False
        tool_calls: dict[int, dict[str, Any]] = {}

        yield sse(
            {
                "type": "response.created",
                "response": {
                    "id": response_id,
                    "object": "response",
                    "status": "in_progress",
                    "model": payload["model"],
                    "output": [],
                },
            },
            "response.created",
        )

        async for chunk in events:
            if isinstance(chunk, str):
                if chunk.strip() == "data: [DONE]":
                    break
                chunk = json.loads(chunk.removeprefix("data: ").strip())
            if chunk.get("done"):
                break

            choice = (chunk.get("choices") or [{}])[0]
            delta = choice.get("delta", {}) or {}

            if delta.get("content"):
                if not text_started:
                    output_index += 1
                    text_started = True

                yield sse(
                    {
                        "type": "response.output_text.delta",
                        "output_index": output_index,
                        "delta": delta["content"],
                    },
                    "response.output_text.delta",
                )

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
            output.append(
                {
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [{"type": "output_text", "text": "", "annotations": []}],
                }
            )

        for tool_call in tool_calls.values():
            output.append(
                {
                    "type": "function_call",
                    "call_id": tool_call["call_id"],
                    "name": tool_call["name"],
                    "arguments": tool_call["arguments"],
                    "status": "completed",
                }
            )

        yield sse(
            {
                "type": "response.completed",
                "response": {
                    "id": response_id,
                    "object": "response",
                    "status": "completed",
                    "model": payload["model"],
                    "output": output,
                },
            },
            "response.completed",
        )

    return execution.stream_response(stream_response())
