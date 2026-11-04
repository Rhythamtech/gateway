import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from backend.gateway.providers.service import read_sse_data
from backend.gateway.streaming import sse


def content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        text = ""
        for part in content:
            if isinstance(part, str):
                text += part
            elif isinstance(part, dict) and part.get("type") in ("text", "input_text", "output_text"):
                text += part.get("text", "")
        return text

    return ""


def anthropic_to_openai(payload: dict[str, Any]) -> dict[str, Any]:
    messages: list[dict[str, Any]] = []

    if payload.get("system"):
        messages.append({
            "role": "system",
            "content": content_to_text(payload["system"]),
        })

    for message in payload.get("messages", []):
        role = message.get("role", "user")
        content = message.get("content")

        if isinstance(content, str):
            messages.append({"role": role, "content": content})
            continue

        text_parts: list[dict[str, Any]] = []
        tool_calls: list[dict[str, Any]] = []
        tool_results: list[dict[str, Any]] = []

        for block in content or []:
            block_type = block.get("type")

            if block_type == "text":
                text_parts.append({"type": "text", "text": block.get("text", "")})

            elif block_type == "image":
                source = block.get("source", {})
                if source.get("type") == "base64":
                    url = f"data:{source.get('media_type', 'image/png')};base64,{source.get('data', '')}"
                else:
                    url = source.get("url", "")
                text_parts.append({"type": "image_url", "image_url": {"url": url}})

            elif block_type == "tool_use":
                tool_calls.append({
                    "id": block.get("id", f"call_{uuid.uuid4().hex[:24]}"),
                    "type": "function",
                    "function": {
                        "name": block.get("name", ""),
                        "arguments": json.dumps(block.get("input", {})),
                    },
                })

            elif block_type == "tool_result":
                result = block.get("content", "")
                if isinstance(result, list):
                    result = "\n".join(
                        item.get("text", "") for item in result if isinstance(item, dict)
                    )
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": block.get("tool_use_id", ""),
                    "content": result,
                })

        if tool_calls:
            messages.append({
                "role": "assistant",
                "content": content_to_text(text_parts) or None,
                "tool_calls": tool_calls,
            })
        elif text_parts:
            messages.append({"role": role, "content": text_parts})

        messages.extend(tool_results)

    tools = []
    for tool in payload.get("tools", []):
        tools.append({
            "type": "function",
            "function": {
                "name": tool.get("name", ""),
                "description": tool.get("description", ""),
                "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
            },
        })

    result: dict[str, Any] = {
        "model": payload.get("model", ""),
        "messages": messages,
        "stream": payload.get("stream", False),
    }

    for key in ("temperature", "top_p", "stop", "user", "metadata", "parallel_tool_calls"):
        if payload.get(key) is not None:
            result[key] = payload[key]

    if payload.get("max_tokens") is not None:
        result["max_tokens"] = payload["max_tokens"]

    if tools:
        result["tools"] = tools

        tool_choice = payload.get("tool_choice", "auto")
        if tool_choice == "any":
            result["tool_choice"] = "required"
        elif isinstance(tool_choice, dict) and tool_choice.get("type") == "tool":
            result["tool_choice"] = {
                "type": "function",
                "function": {"name": tool_choice.get("name", "")},
            }
        else:
            result["tool_choice"] = tool_choice

    return result


def openai_to_anthropic(payload: dict[str, Any]) -> dict[str, Any]:
    system_parts: list[str] = []
    messages: list[dict[str, Any]] = []

    for message in payload.get("messages", []):
        role = message.get("role")
        content = message.get("content")

        if role in ("system", "developer"):
            system_parts.append(content_to_text(content))
            continue

        if role == "tool":
            messages.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": message.get("tool_call_id", ""),
                    "content": [{"type": "text", "text": content_to_text(content)}],
                }],
            })
            continue

        blocks: list[dict[str, Any]] = []

        if isinstance(content, str):
            if content:
                blocks.append({"type": "text", "text": content})
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, str):
                    blocks.append({"type": "text", "text": part})
                elif part.get("type") == "text":
                    blocks.append({"type": "text", "text": part.get("text", "")})
                elif part.get("type") == "image_url":
                    url = part.get("image_url", {}).get("url", "")
                    if url.startswith("data:"):
                        header, data = url.split(",", 1)
                        media_type = header.removeprefix("data:").split(";", 1)[0]
                        blocks.append({
                            "type": "image",
                            "source": {"type": "base64", "media_type": media_type, "data": data},
                        })
                    else:
                        blocks.append({
                            "type": "image",
                            "source": {"type": "url", "url": url},
                        })

        for tool_call in message.get("tool_calls") or []:
            function = tool_call.get("function", {})
            try:
                tool_input = json.loads(function.get("arguments") or "{}")
            except json.JSONDecodeError:
                tool_input = {}

            blocks.append({
                "type": "tool_use",
                "id": tool_call.get("id", f"toolu_{uuid.uuid4().hex[:24]}"),
                "name": function.get("name", ""),
                "input": tool_input,
            })

        if not blocks:
            blocks.append({"type": "text", "text": ""})

        messages.append({
            "role": "assistant" if role == "assistant" else "user",
            "content": blocks,
        })

    tools = []
    for tool in payload.get("tools", []):
        if tool.get("type") == "function":
            function = tool.get("function", {})
            tools.append({
                "name": function.get("name", ""),
                "description": function.get("description", ""),
                "input_schema": function.get("parameters", {"type": "object", "properties": {}}),
            })

    result: dict[str, Any] = {
        "model": payload.get("model", ""),
        "max_tokens": payload.get("max_tokens") or payload.get("max_completion_tokens") or 4096,
        "messages": messages,
        "stream": payload.get("stream", False),
    }

    if system_parts:
        result["system"] = "\n\n".join(system_parts)

    for key in ("temperature", "top_p", "metadata", "user"):
        if payload.get(key) is not None:
            result[key] = payload[key]

    if payload.get("stop") is not None:
        stop = payload["stop"]
        result["stop_sequences"] = stop if isinstance(stop, list) else [stop]

    if tools:
        result["tools"] = tools

        tool_choice = payload.get("tool_choice", "auto")
        if tool_choice == "required":
            result["tool_choice"] = {"type": "any"}
        elif isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
            result["tool_choice"] = {
                "type": "tool",
                "name": tool_choice.get("function", {}).get("name", ""),
            }
        else:
            result["tool_choice"] = {"type": "auto"}

    return result


def anthropic_to_openai_response(message: dict[str, Any]) -> dict[str, Any]:
    text = ""
    tool_calls = []

    for block in message.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")
        elif block.get("type") == "tool_use":
            tool_calls.append({
                "id": block.get("id", ""),
                "type": "function",
                "function": {
                    "name": block.get("name", ""),
                    "arguments": json.dumps(block.get("input", {})),
                },
            })

    message_data: dict[str, Any] = {"role": "assistant", "content": text or None}
    if tool_calls:
        message_data["tool_calls"] = tool_calls

    finish_reason = {
        "tool_use": "tool_calls",
        "max_tokens": "length",
        "stop_sequence": "stop",
    }.get(message.get("stop_reason"), "stop")

    usage = message.get("usage", {})

    return {
        "id": message.get("id", f"chatcmpl-{uuid.uuid4().hex[:24]}"),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": message.get("model", ""),
        "choices": [{
            "index": 0,
            "message": message_data,
            "logprobs": None,
            "finish_reason": finish_reason,
        }],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        },
    }


def openai_to_anthropic_response(completion: dict[str, Any], request_model: str) -> dict[str, Any]:
    choice = completion.get("choices", [{}])[0]
    message = choice.get("message", {})
    usage = completion.get("usage", {})

    content: list[dict[str, Any]] = []

    text = content_to_text(message.get("content"))
    if text:
        content.append({"type": "text", "text": text})

    for tool_call in message.get("tool_calls") or []:
        function = tool_call.get("function", {})
        try:
            tool_input = json.loads(function.get("arguments") or "{}")
        except json.JSONDecodeError:
            tool_input = {}

        content.append({
            "type": "tool_use",
            "id": tool_call.get("id", f"toolu_{uuid.uuid4().hex[:24]}"),
            "name": function.get("name", ""),
            "input": tool_input,
        })

    if not content:
        content.append({"type": "text", "text": ""})

    stop_reason = {
        "tool_calls": "tool_use",
        "length": "max_tokens",
        "stop": "stop_sequence",
    }.get(choice.get("finish_reason"), "end_turn")

    return {
        "id": completion.get("id", f"msg_{uuid.uuid4().hex[:24]}"),
        "type": "message",
        "role": "assistant",
        "model": request_model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


async def anthropic_stream_to_openai(
    response, model: str, *, events=None
) -> AsyncIterator[str]:
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
    created = int(time.time())
    sent_role = False
    tool_blocks: dict[int, dict[str, Any]] = {}
    finish_reason = None

    def chunk(delta: dict[str, Any], finish: str | None = None) -> str:
        nonlocal sent_role
        if not sent_role:
            delta = {"role": "assistant", **delta}
            sent_role = True
        return sse({
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{
                "index": 0,
                "delta": delta,
                "logprobs": None,
                "finish_reason": finish,
            }],
        })

    async for event in events if events is not None else read_sse_data(response):
        if event.get("done"):
            break

        event_type = event.get("type") or event.get("event")

        if event_type == "content_block_start":
            block = event.get("content_block", {})
            if block.get("type") == "tool_use":
                index = event.get("index", 0)
                tool_blocks[index] = {"name": block.get("name", "")}
                yield chunk({
                    "tool_calls": [{
                        "index": len(tool_blocks) - 1,
                        "id": block.get("id", ""),
                        "type": "function",
                        "function": {"name": block.get("name", ""), "arguments": ""},
                    }]
                })

        elif event_type == "content_block_delta":
            delta = event.get("delta", {})

            if delta.get("type") == "text_delta":
                yield chunk({"content": delta.get("text", "")})

            elif delta.get("type") == "input_json_delta":
                yield chunk({
                    "tool_calls": [{
                        "index": max(len(tool_blocks) - 1, 0),
                        "function": {"arguments": delta.get("partial_json", "")},
                    }]
                })

        elif event_type == "message_delta":
            stop_reason = event.get("delta", {}).get("stop_reason")
            finish_reason = {
                "tool_use": "tool_calls",
                "max_tokens": "length",
                "stop_sequence": "stop",
            }.get(stop_reason, "stop")
            yield chunk({}, finish_reason)

        elif event_type == "message_stop":
            break

    yield "data: [DONE]\n\n"


async def openai_stream_to_anthropic(
    response, model: str, *, events=None
) -> AsyncIterator[str]:
    message_id = f"msg_{uuid.uuid4().hex[:24]}"
    block_index = -1
    current_kind = ""
    tool_blocks: dict[int, int] = {}
    stop_reason = "end_turn"
    started = False

    def event(name: str, data: dict[str, Any]) -> str:
        return sse(data, name)

    def start_message() -> str:
        nonlocal started
        started = True
        return event("message_start", {
            "type": "message_start",
            "message": {
                "id": message_id,
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": 0, "output_tokens": 0},
            },
        })

    def close_block() -> str:
        nonlocal block_index, current_kind
        if block_index >= 0:
            data = event("content_block_stop", {
                "type": "content_block_stop",
                "index": block_index,
            })
            block_index = -1
            current_kind = ""
            return data
        return ""

    async for chunk in events if events is not None else read_sse_data(response):
        if chunk.get("done"):
            break

        if not started:
            yield start_message()

        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta", {}) or {}

        if delta.get("content"):
            if current_kind != "text":
                yield close_block()
                block_index += 1
                current_kind = "text"
                yield event("content_block_start", {
                    "type": "content_block_start",
                    "index": block_index,
                    "content_block": {"type": "text", "text": ""},
                })

            yield event("content_block_delta", {
                "type": "content_block_delta",
                "index": block_index,
                "delta": {"type": "text_delta", "text": delta["content"]},
            })

        for tool_call in delta.get("tool_calls") or []:
            upstream_index = tool_call.get("index", 0)
            function = tool_call.get("function", {}) or {}

            if upstream_index not in tool_blocks:
                yield close_block()
                block_index += 1
                current_kind = "tool_use"
                tool_blocks[upstream_index] = block_index
                yield event("content_block_start", {
                    "type": "content_block_start",
                    "index": block_index,
                    "content_block": {
                        "type": "tool_use",
                        "id": tool_call.get("id", f"toolu_{uuid.uuid4().hex[:24]}"),
                        "name": function.get("name", ""),
                        "input": {},
                    },
                })

            if function.get("arguments"):
                yield event("content_block_delta", {
                    "type": "content_block_delta",
                    "index": tool_blocks[upstream_index],
                    "delta": {
                        "type": "input_json_delta",
                        "partial_json": function["arguments"],
                    },
                })

        if choice.get("finish_reason"):
            stop_reason = {
                "tool_calls": "tool_use",
                "length": "max_tokens",
                "stop": "end_turn",
            }.get(choice["finish_reason"], "end_turn")

    yield close_block()
    yield event("message_delta", {
        "type": "message_delta",
        "delta": {"stop_reason": stop_reason, "stop_sequence": None},
        "usage": {"output_tokens": 0},
    })
    yield event("message_stop", {"type": "message_stop"})
