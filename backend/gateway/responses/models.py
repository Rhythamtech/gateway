import time
import uuid
from typing import Any

from backend.gateway.streaming import sse


def text_of(content: Any) -> str:
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        return "".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict)
            and part.get("type") in ("text", "input_text", "output_text")
        )

    return ""


def responses_to_chat(payload: dict[str, Any]) -> dict[str, Any]:
    messages: list[dict[str, Any]] = []

    if payload.get("instructions"):
        messages.append({"role": "system", "content": payload["instructions"]})

    input_value = payload.get("input", "")

    if isinstance(input_value, str):
        messages.append({"role": "user", "content": input_value})

    elif isinstance(input_value, list):
        for item in input_value:
            if isinstance(item, str):
                messages.append({"role": "user", "content": item})
                continue

            item_type = item.get("type", "message")

            if item_type == "message":
                content = item.get("content", "")
                converted = []

                if isinstance(content, list):
                    for part in content:
                        if isinstance(part, str):
                            converted.append({"type": "text", "text": part})
                        elif part.get("type") in ("input_text", "output_text", "text"):
                            converted.append({"type": "text", "text": part.get("text", "")})
                        elif part.get("type") in ("input_image", "image_url"):
                            image = part.get("image_url") or part.get("image") or {}
                            url = image.get("url", "") if isinstance(image, dict) else image
                            converted.append({"type": "image_url", "image_url": {"url": url}})

                    content = converted

                messages.append({"role": item.get("role", "user"), "content": content})

            elif item_type == "function_call":
                messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": item.get("call_id") or item.get("id", f"call_{uuid.uuid4().hex[:24]}"),
                        "type": "function",
                        "function": {
                            "name": item.get("name", ""),
                            "arguments": item.get("arguments", "{}"),
                        },
                    }],
                })

            elif item_type == "function_call_output":
                messages.append({
                    "role": "tool",
                    "tool_call_id": item.get("call_id", ""),
                    "content": text_of(item.get("output", "")),
                })

    tools = []
    for tool in payload.get("tools", []):
        if tool.get("type") == "function":
            tools.append({
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
                },
            })

    chat: dict[str, Any] = {
        "model": payload.get("model", ""),
        "messages": messages,
        "stream": payload.get("stream", False),
    }

    for source, target in (
        ("temperature", "temperature"),
        ("top_p", "top_p"),
        ("max_output_tokens", "max_tokens"),
        ("parallel_tool_calls", "parallel_tool_calls"),
        ("user", "user"),
        ("metadata", "metadata"),
    ):
        if payload.get(source) is not None:
            chat[target] = payload[source]

    text_format = payload.get("text", {}).get("format", {})
    if text_format.get("type") == "json_schema":
        chat["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": text_format.get("name", "response"),
                "schema": text_format.get("schema", {}),
            },
        }
    elif text_format.get("type") == "json_object":
        chat["response_format"] = {"type": "json_object"}

    if tools:
        chat["tools"] = tools

        tool_choice = payload.get("tool_choice", "auto")
        if isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
            chat["tool_choice"] = {
                "type": "function",
                "function": {"name": tool_choice.get("name", "")},
            }
        else:
            chat["tool_choice"] = tool_choice

    return chat


def chat_to_responses(completion: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    choice = completion.get("choices", [{}])[0]
    message = choice.get("message", {})
    usage = completion.get("usage", {})

    output: list[dict[str, Any]] = []

    text = text_of(message.get("content"))
    if text:
        output.append({
            "type": "message",
            "id": f"msg_{uuid.uuid4().hex[:24]}",
            "status": "completed",
            "role": "assistant",
            "content": [{"type": "output_text", "text": text, "annotations": []}],
        })

    for tool_call in message.get("tool_calls") or []:
        function = tool_call.get("function", {})
        output.append({
            "type": "function_call",
            "id": f"fc_{uuid.uuid4().hex[:24]}",
            "call_id": tool_call.get("id", f"call_{uuid.uuid4().hex[:24]}"),
            "name": function.get("name", ""),
            "arguments": function.get("arguments", "{}"),
            "status": "completed",
        })

    return {
        "id": f"resp_{uuid.uuid4().hex[:24]}",
        "object": "response",
        "created_at": int(time.time()),
        "status": "completed",
        "model": request.get("model", ""),
        "output": output,
        "tools": request.get("tools", []),
        "tool_choice": request.get("tool_choice", "auto"),
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        },
    }
