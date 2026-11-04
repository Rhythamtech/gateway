from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import httpx
from fastapi import Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from backend.core.errors import GatewayError
from backend.credits import service
from backend.gateway.providers.service import (
    RuntimeProvider,
    call_provider,
    read_sse_data,
)
from backend.gateway.routing import RouteCandidate, plan
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

    async def send(self, payload: dict[str, Any]) -> httpx.Response:
        if self.provider.protocol == "openai" and payload.get("stream"):
            payload["stream_options"] = {
                **(payload.get("stream_options") or {}),
                "include_usage": True,
            }
        service.mark_dispatched(self.reservation.usage_id)
        try:
            self.response = await call_provider(
                self.candidate.provider_alias, payload, bool(payload.get("stream"))
            )
            request_id = self.response.headers.get(
                "x-request-id"
            ) or self.response.headers.get("request-id")
            if request_id:
                self.provider_request_id = request_id
                service.record_provider_reference(self.reservation.usage_id, request_id)
            return self.response
        except BaseException as exc:
            service.mark_for_review(
                self.reservation.usage_id,
                "Upstream dispatch failed or its outcome is unknown",
            )
            self.capture.failure(exc)
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
                    502, "upstream_error", "Provider returned invalid JSON"
                ) from None
            if not isinstance(data, dict) or data.get("error"):
                raise GatewayError(
                    502, "upstream_error", "Provider returned an invalid response"
                )
            self.raw_usage = (
                data.get("usage") if isinstance(data.get("usage"), dict) else {}
            )
            if data.get("id"):
                self.provider_request_id = str(data["id"])
            self.finalize_usage()
            self.capture.success(data, protocol=self.provider.protocol)
            return data
        except BaseException as exc:
            service.mark_for_review(
                self.reservation.usage_id, "Provider response could not be finalized"
            )
            self.capture.failure(exc)
            raise
        finally:
            await self.response.aclose()

    async def observe_events(self) -> AsyncIterator[dict[str, Any]]:
        try:
            async for event in read_sse_data(self.response):
                previous_id = self.provider_request_id
                if event.get("error") or event.get("type") == "error":
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
                    service.record_provider_reference(
                        self.reservation.usage_id, self.provider_request_id
                    )
                if isinstance(raw_usage, dict):
                    self.raw_usage.update(raw_usage)
                if terminal:
                    self.complete = True
                    if self.final_usage_received and not self.stream_failed:
                        self.finalize_usage()
                    else:
                        service.mark_for_review(
                            self.reservation.usage_id,
                            "Stream did not provide trustworthy final usage",
                        )
                yield event
        finally:
            await self.close_stream()

    def stream_events(self) -> AsyncIterator[dict[str, Any]]:
        self.events = monitor_stream(
            self.observe_events(), self.capture, protocol=self.provider.protocol
        )
        return self.events

    async def close_stream(self) -> None:
        if self.response is not None:
            await self.response.aclose()
        if not self.complete:
            service.mark_for_review(
                self.reservation.usage_id,
                "Stream ended before complete provider usage was confirmed",
            )

    def stream_response(self, pieces: AsyncIterator[str]) -> StreamingResponse:
        async def managed_stream():
            try:
                async for piece in pieces:
                    yield piece
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


def admit_request(
    request: Request, payload: dict[str, Any], capture: CallCapture
) -> CreditExecution:
    output_tokens = validate_credit_request(payload)
    request_id = str(uuid4())
    errors: list[GatewayError] = []
    candidates = plan(payload["model"])
    for candidate in candidates:
        try:
            reservation = service.reserve_request_credits(
                candidate,
                request.state.api_key_owner_id,
                request.state.api_key_id,
                request_id,
                output_tokens,
            )
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
            bounded_payload = dict(payload)
            output_key = (
                "max_completion_tokens"
                if "max_completion_tokens" in payload
                else "max_tokens"
            )
            for key in ("max_tokens", "max_completion_tokens", "max_output_tokens"):
                bounded_payload.pop(key, None)
            if output_tokens is not None:
                bounded_payload[output_key] = output_tokens
            provider = capture.begin_attempt(
                candidate, bounded_payload, stream=bool(payload.get("stream"))
            )
        except BaseException:
            service.release_undispatched_request(reservation.usage_id)
            raise
        return CreditExecution(
            candidate, provider, reservation, capture, bounded_payload
        )
    if errors:
        user_error = next(
            (error for error in errors if error.code == "insufficient_credits"), None
        )
        raise user_error or errors[-1]
    raise GatewayError(
        503, "no_available_member", "No eligible provider can serve this request"
    )
