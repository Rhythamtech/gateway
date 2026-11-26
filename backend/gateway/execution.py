import asyncio
import json
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import tiktoken
from fastapi import Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from backend.core.errors import GatewayError, request_timeout
from backend.credits import service
from backend.gateway.chat.models import anthropic_to_openai, openai_to_anthropic
from backend.gateway.providers.service import (
    RuntimeProvider,
    call_provider,
    count_anthropic_input_tokens,
    get_provider,
    provider_error_body,
    read_sse_data,
)
from backend.gateway.routing import RouteCandidate, plan
from backend.gateway.streaming import sse
from backend.traces.capture import CallCapture, monitor_stream


def validate_credit_request(payload: dict[str, Any]) -> int | None:
    for key in ("n", "best_of"):
        if key in payload and (type(payload[key]) is not int or payload[key] != 1):
            raise GatewayError(400, "unsupported_parameter", f"{key} must be 1")
    for key in ("audio", "prediction", "web_search_options"):
        if payload.get(key) is not None:
            raise GatewayError(
                400,
                "unsupported_parameter",
                f"{key} is not supported for credit billing",
            )
    if payload.get("modalities") not in (None, ["text"]):
        raise GatewayError(
            400, "unsupported_parameter", "Only text output is supported"
        )
    for tool in payload.get("tools") or []:
        if not isinstance(tool, dict) or tool.get("type") not in (None, "function"):
            raise GatewayError(
                400,
                "unsupported_parameter",
                "Only client-executed function tools are supported",
            )
    if payload.get("stream_options") is not None and not isinstance(
        payload["stream_options"], dict
    ):
        raise GatewayError(
            400, "invalid_request_error", "stream_options must be an object"
        )
    validate_content(payload.get("messages", payload.get("input", [])))
    validate_content(payload.get("system", []))
    limits = [
        payload[key]
        for key in ("max_tokens", "max_completion_tokens", "max_output_tokens")
        if payload.get(key) is not None
    ]
    if len(limits) > 1:
        raise GatewayError(
            400, "invalid_request_error", "Specify only one output token limit"
        )
    if limits and (type(limits[0]) is not int or not 0 < limits[0] <= 1_000_000):
        raise GatewayError(
            400,
            "invalid_request_error",
            "Output token limit must be a positive integer at most 1000000",
        )
    return limits[0] if limits else None


def validate_content(value: Any) -> None:
    if isinstance(value, list):
        for item in value:
            validate_content(item)
    elif isinstance(value, dict):
        if value.get("type") in (
            "image",
            "image_url",
            "input_image",
            "input_audio",
            "audio",
            "file",
            "input_file",
            "document",
            "video",
        ):
            raise GatewayError(
                400,
                "unsupported_parameter",
                "Only text and function-call content are supported for credit billing",
            )
        for key in ("content", "output"):
            if key in value:
                validate_content(value[key])


def provider_token_usage(raw: dict[str, Any], protocol: str) -> tuple[int, int] | None:
    def token_count(key: str, default=None):
        value = raw.get(key, default)
        return value if type(value) is int and 0 <= value <= 10_000_000 else None

    if protocol == "anthropic":
        components = [
            token_count("input_tokens"),
            token_count("cache_read_input_tokens", 0),
            token_count("cache_creation_input_tokens", 0),
        ]
        output = token_count("output_tokens")
        if any(value is None for value in components) or output is None:
            return None
        return sum(components), output
    prompt = token_count("prompt_tokens")
    output = token_count("completion_tokens")
    if prompt is None or output is None:
        return None
    return prompt, output


def dispatch_review_reason(error: BaseException) -> str:
    if isinstance(error, GatewayError):
        if error.code == "request_timeout":
            return error.message
        if error.code == "upstream_timeout":
            return "Provider timed out before usage could be confirmed."
        if error.code == "dispatch_failed":
            return "Could not send the request to the provider."
        if error.code == "configuration_error":
            return "Provider configuration prevented dispatch."
        if error.code == "upstream_error" and error.message == "Provider returned an error":
            return f"Provider returned HTTP {error.status_code} before usage could be confirmed."
    return "Provider request failed before usage could be confirmed."


class CreditExecution:
    def __init__(
        self,
        candidate: RouteCandidate,
        provider: RuntimeProvider,
        reservation: service.CreditReservation,
        capture: CallCapture,
        payload: dict[str, Any],
    ):
        self.candidate = candidate
        self.provider = provider
        self.reservation = reservation
        self.capture = capture
        self.payload = payload
        self.response: httpx.Response | None = None
        self.raw_usage: dict[str, Any] = {}
        self.provider_request_id: str | None = None
        self.complete = False
        self.stream_failed = False
        self.final_usage_received = False
        self.events: AsyncIterator[dict[str, Any]] | None = None
        self.dispatch_started: float | None = None
        self.first_content_seen = False

    async def send(self, payload: dict[str, Any]) -> httpx.Response:
        if self.provider.protocol == "openai" and payload.get("stream"):
            payload["stream_options"] = {
                **(payload.get("stream_options") or {}),
                "include_usage": True,
            }
        if self.capture.remaining_seconds() <= 0:
            error = request_timeout()
            await run_in_threadpool(service.release_undispatched_request, self.reservation.usage_id)
            await run_in_threadpool(self.capture.failure, error)
            raise error

        await run_in_threadpool(service.mark_dispatched, self.reservation.usage_id)
        self.dispatch_started = time.monotonic()
        try:
            try:
                remaining = self.capture.remaining_seconds()
                if remaining <= 0:
                    raise request_timeout()
                async with asyncio.timeout(remaining):
                    self.response = await call_provider(
                        self.provider,
                        payload,
                        bool(payload.get("stream")),
                        capture_error=self.capture.records_traces,
                        detect_tool_rejection=self.candidate.runtime_fallback,
                    )
            except TimeoutError:
                raise request_timeout() from None
            if self.capture._span is not None:
                self.capture._span.set_attribute("gateway.upstream_headers_ms", (time.monotonic() - self.dispatch_started) * 1000)
            request_id = self.response.headers.get(
                "x-request-id"
            ) or self.response.headers.get("request-id")
            if request_id:
                self.provider_request_id = request_id
                await run_in_threadpool(service.record_provider_reference, self.reservation.usage_id, request_id)
            return self.response
        except BaseException as exc:
            await run_in_threadpool(
                service.mark_for_review, self.reservation.usage_id, dispatch_review_reason(exc)
            )
            await run_in_threadpool(self.capture.failure, exc)
            raise

    def finalize_usage(self) -> None:
        tokens = provider_token_usage(self.raw_usage, self.provider.protocol)
        if tokens is None:
            service.mark_for_review(
                self.reservation.usage_id,
                "Complete provider-reported token usage is unavailable",
            )
            return
        service.record_usage(
            self.reservation.usage_id, *tokens, self.provider_request_id
        )
        service.settle_request_usage(self.reservation.usage_id)

    async def read_json(self) -> dict[str, Any]:
        try:
            try:
                data = self.response.json()
            except ValueError:
                raise GatewayError(
                    502, "upstream_error", "Provider returned invalid JSON",
                    provider_status=self.response.status_code,
                    provider_response=self._error_response_body(),
                ) from None
            if not isinstance(data, dict) or data.get("error") or data.get("type") == "error":
                raise GatewayError(
                    502, "upstream_error", "Provider returned an invalid response",
                    provider_status=self.response.status_code,
                    provider_response=self._error_response_body(),
                )
            self.raw_usage = (
                data.get("usage") if isinstance(data.get("usage"), dict) else {}
            )
            if data.get("id"):
                self.provider_request_id = str(data["id"])
            await run_in_threadpool(self.finalize_usage)
            await run_in_threadpool(self.capture.success, data, protocol=self.provider.protocol)
            return data
        except BaseException as exc:
            await run_in_threadpool(service.mark_for_review, self.reservation.usage_id,
                                    "Provider response could not be finalized")
            await run_in_threadpool(self.capture.failure, exc)
            raise
        finally:
            await self.response.aclose()

    def _error_response_body(self) -> str | None:
        if self.capture.records_traces:
            return provider_error_body(self.response, self.response.content)
        return None

    async def observe_events(self) -> AsyncIterator[dict[str, Any]]:
        events = read_sse_data(self.response)
        try:
            while True:
                try:
                    remaining = self.capture.remaining_seconds()
                    if remaining <= 0:
                        raise request_timeout()
                    async with asyncio.timeout(remaining):
                        event = await anext(events)
                except StopAsyncIteration:
                    break
                except TimeoutError:
                    raise request_timeout() from None
                if not self.first_content_seen and self.dispatch_started is not None:
                    delta = event.get("delta") or {}
                    choices = event.get("choices") or []
                    content = delta.get("text") if isinstance(delta, dict) else None
                    if choices and isinstance(choices[0], dict):
                        content = content or (choices[0].get("delta") or {}).get("content")
                    if content:
                        self.first_content_seen = True
                        if self.capture._span is not None:
                            self.capture._span.set_attribute("gateway.upstream_first_content_ms", (time.monotonic() - self.dispatch_started) * 1000)
                previous_id = self.provider_request_id
                if event.get("error") or "error" in (event.get("type"), event.get("event")):
                    self.stream_failed = True
                if self.provider.protocol == "anthropic":
                    event_type = event.get("type") or event.get("event")
                    message = event.get("message") or {}
                    raw_usage = (
                        message.get("usage")
                        if event_type == "message_start"
                        else event.get("usage")
                    )
                    if message.get("id"):
                        self.provider_request_id = str(message["id"])
                    if event_type == "message_delta" and isinstance(
                        event.get("usage"), dict
                    ):
                        self.final_usage_received = True
                    terminal = event_type == "message_stop"
                else:
                    raw_usage = event.get("usage")
                    if isinstance(raw_usage, dict):
                        self.final_usage_received = True
                    if event.get("id"):
                        self.provider_request_id = str(event["id"])
                    terminal = bool(event.get("done"))
                if self.provider_request_id and self.provider_request_id != previous_id:
                    await run_in_threadpool(service.record_provider_reference,
                                            self.reservation.usage_id, self.provider_request_id)
                if isinstance(raw_usage, dict):
                    self.raw_usage.update(raw_usage)
                if terminal:
                    self.complete = True
                    if self.final_usage_received and not self.stream_failed:
                        await run_in_threadpool(self.finalize_usage)
                    else:
                        await run_in_threadpool(service.mark_for_review, self.reservation.usage_id,
                                                "Stream did not provide trustworthy final usage")
                yield event
                if terminal:
                    break
        finally:
            await events.aclose()
            await self.close_stream()

    def stream_events(self) -> AsyncIterator[dict[str, Any]]:
        self.events = monitor_stream(
            self.observe_events(), self.capture,
            protocol=self.provider.protocol, provider_status=self.response.status_code,
        )
        return self.events

    async def close_stream(self) -> None:
        if self.response is not None:
            await self.response.aclose()
        if not self.complete:
            await run_in_threadpool(service.mark_for_review, self.reservation.usage_id,
                                    "Stream ended before complete provider usage was confirmed")

    def stream_response(
        self, pieces: AsyncIterator[str], *, anthropic: bool = False
    ) -> StreamingResponse:
        async def managed_stream():
            try:
                async for piece in pieces:
                    yield piece
            except GatewayError as error:
                if error.code != "request_timeout":
                    raise
                if anthropic:
                    yield sse({
                        "type": "error",
                        "error": {"type": "timeout_error", "message": error.message},
                    }, "error")
                else:
                    yield sse({
                        "error": {
                            "type": error.code, "code": error.code,
                            "message": error.message,
                        },
                    })
            finally:
                await pieces.aclose()
                if self.events is not None:
                    await self.events.aclose()
                await self.close_stream()

        return StreamingResponse(
            managed_stream(),
            media_type="text/event-stream",
            background=BackgroundTask(self.close_stream),
        )


def estimate_input_tokens(payload: dict[str, Any], candidate: RouteCandidate) -> int:
    if candidate.protocol == "anthropic":
        try:
            provider = get_provider(candidate.provider_alias)
        except GatewayError:
            provider = None
        if provider and provider.id == candidate.provider_id:
            count = count_anthropic_input_tokens(provider, candidate.upstream_model, payload)
            if count is not None:
                return count

    prompt = {
        key: payload[key]
        for key in (
            "messages", "system", "tools", "tool_choice", "functions",
            "function_call", "response_format", "output_config",
        )
        if payload.get(key)
    }
    serialized = json.dumps(prompt, ensure_ascii=False)
    if candidate.protocol == "openai":
        model = candidate.upstream_model.removeprefix("openai/")
        try:
            encoding = tiktoken.encoding_for_model(model)
        except (KeyError, OSError):
            pass
        else:
            # Budget for message framing in addition to the serialized input.
            return 16 + len(encoding.encode_ordinary(serialized))

    return 16 + len(serialized.encode("utf-8", "surrogatepass"))


def _admit_attempts(
    request: Request,
    payload: dict[str, Any],
    capture: CallCapture,
    *,
    input_protocol: str = "openai",
) -> Iterator[CreditExecution]:
    output_tokens = validate_credit_request(payload)
    request_id = capture.request_id
    errors: list[GatewayError] = []
    admitted = False
    routing_started = time.monotonic()
    candidates = plan(payload["model"])
    routing_ms = (time.monotonic() - routing_started) * 1000
    for candidate in candidates:
        provider_payload = payload
        if input_protocol != candidate.protocol:
            convert = (
                openai_to_anthropic if candidate.protocol == "anthropic" else anthropic_to_openai
            )
            provider_payload = convert(payload)
        estimated_input_tokens = estimate_input_tokens(provider_payload, candidate)
        try:
            reservation_started = time.monotonic()
            reservation = service.reserve_request_credits(
                candidate,
                request.state.api_key_owner_id,
                request.state.api_key_id,
                request_id,
                output_tokens,
                estimated_input_tokens,
            )
            reservation_ms = (time.monotonic() - reservation_started) * 1000
        except GatewayError as exc:
            if exc.code in (
                "provider_credits_exhausted",
                "model_rate_missing",
                "model_unavailable",
                "output_limit_exceeded",
                "insufficient_credits",
            ):
                errors.append(exc)
                continue
            raise
        try:
            bounded_payload = dict(provider_payload)
            output_key = (
                "max_completion_tokens"
                if candidate.protocol == "openai" and "max_completion_tokens" in payload
                else "max_tokens"
            )
            for key in ("max_tokens", "max_completion_tokens", "max_output_tokens"):
                bounded_payload.pop(key, None)
            bounded_payload[output_key] = reservation.output_tokens
            bounded_payload["model"] = candidate.upstream_model
            provider = capture.begin_attempt(
                candidate, bounded_payload, stream=bool(payload.get("stream"))
            )
            if capture._span is not None:
                capture._span.set_attribute("gateway.routing_ms", routing_ms)
                capture._span.set_attribute("gateway.reservation_ms", reservation_ms)
        except BaseException as error:
            service.release_undispatched_request(reservation.usage_id)
            if (
                candidate.runtime_fallback
                and isinstance(error, GatewayError)
                and error.code in (
                    "model_unavailable", "invalid_request_error", "configuration_error",
                )
            ):
                errors.append(error)
                continue
            raise
        admitted = True
        yield CreditExecution(candidate, provider, reservation, capture, bounded_payload)
    if admitted:
        return
    if errors:
        user_error = next(
            (error for error in errors if error.code == "insufficient_credits"), None
        )
        raise user_error or errors[-1]
    raise GatewayError(
        503, "no_available_member", "No eligible provider can serve this request"
    )


def _can_fallback(error: GatewayError) -> bool:
    status = error.provider_status
    if status is not None:
        return (
            status in (408, 429)
            or 500 <= status < 600
            or (status == 400 and error.automatic_tool_choice_rejected)
        )
    return error.code in ("dispatch_failed", "upstream_timeout", "upstream_error")


async def dispatch_request(
    request: Request,
    payload: dict[str, Any],
    capture: CallCapture,
    *,
    input_protocol: str = "openai",
) -> tuple[CreditExecution, httpx.Response]:
    """Open one upstream response, trying eligible fallback members as needed."""

    attempts = _admit_attempts(request, payload, capture, input_protocol=input_protocol)
    last_error: GatewayError | None = None
    while True:
        if last_error is not None and capture.remaining_seconds() <= 0:
            raise request_timeout()
        try:
            execution = await run_in_threadpool(next, attempts, None)
        except GatewayError as error:
            if last_error is None:
                await run_in_threadpool(capture.failure, error)
            raise
        if execution is None:
            # Admission raises its own error when no attempt can be made.
            assert last_error is not None
            raise last_error

        try:
            response = await execution.send(execution.payload)
        except GatewayError as error:
            if not execution.candidate.runtime_fallback or not _can_fallback(error):
                raise
            last_error = error
        else:
            return execution, response
