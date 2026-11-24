"""Capture of one inbound gateway request across its provider attempt.

One ``CallCapture`` per inbound message/request:

* the sanitized request payload is stored once (``llm_message_traces``),
* every actual upstream attempt gets its own ``pending`` call trace before
  dispatch and is finalized (usage, latency, status) right after the attempt
  completes,
* the same attempt also emits one OpenTelemetry ``gateway.llm.call`` span
  (config-driven, independent of the per-user trace setting).

Tracing is enabled by default for new accounts (``users.tracing_enabled``). Requests
from users with tracing disabled persist no trace rows and no usage
aggregates. Telemetry spans follow the separate ``users.telemetry_enabled``
flag. Capture must never break inference — every recording path swallows its
own errors at ``ERROR`` level.
"""

import logging
import time
from starlette.concurrency import run_in_threadpool
from datetime import datetime, timezone
from typing import Any, AsyncIterator
from uuid import uuid4

import httpx
from opentelemetry.trace import Span

from backend.core.errors import GatewayError
from backend.gateway.providers.service import get_provider, inference_endpoint
from backend.telemetry import finish_attempt_span, start_attempt_span
from backend.traces import service
from backend.traces.redaction import provider_error_details, serialize_request_payload
from backend.traces.usage import (
    TokenUsage,
    canonical_input_tokens,
    normalize_provider_usage,
    total_cache_tokens,
)

logger = logging.getLogger(__name__)

# Provider timeout errors are recorded as the timeout attempt status.
_TIMEOUT_ERROR_CODES = ("upstream_timeout", "request_timeout")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _elapsed_ms(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1000))


def _failure_status(error: BaseException, default_error_code: str) -> tuple[str, str]:
    """Map a capture failure to its (attempt status, error_code) pair."""

    status = service.STATUS_FAILED
    error_code = default_error_code

    if isinstance(error, GatewayError):
        error_code = error.code
        if error.code in _TIMEOUT_ERROR_CODES:
            status = service.STATUS_TIMEOUT

    return status, error_code


class CallCapture:
    """Records the request context, the provider attempt and its usage."""

    def __init__(
        self,
        *,
        user_id: str | None,
        api_key_id: str | None,
        request_json: str | None,
        tracing_enabled: bool = False,
        spans_on: bool = False,
    ):
        self._user_id = user_id
        self._api_key_id = api_key_id
        self._request_json = request_json
        self._tracing_enabled = tracing_enabled
        self._spans_on = spans_on
        self._span: Span | None = None
        self._started = time.monotonic()
        self._call_trace_id: str | None = None
        self._last_payload: dict[str, Any] = {}
        self._stream_protocol: str | None = None
        # Attempt references set by begin_attempt; failures that happen
        # before any attempt row exists (planning/resolution errors) are
        # recorded through the fallback path.
        self._gateway_model_id: str | None = None
        self._provider_model_id: str | None = None
        self._provider_id: str | None = None
        self._upstream_model: str | None = None
        self._request_operation: str | None = None
        self._provider_operation: str | None = None
        self._secrets: tuple[str, ...] = ()
        self.request_id = str(uuid4())
        self.message_trace_id: str | None = None

    @classmethod
    def start(cls, request: Any, payload: Any) -> "CallCapture":
        user_id = getattr(request.state, "api_key_owner_id", None)
        api_key_id = getattr(request.state, "api_key_id", None)
        # Respect the key owner's saved preference before serializing payloads.
        tracing_on = bool(getattr(request.state, "tracing_enabled", False))
        request_json = serialize_request_payload(payload) if tracing_on else None
        # Spans carry the key owner's own opt-out (see docs/tracing.md).
        spans_on = bool(getattr(request.state, "telemetry_enabled", False))

        capture = cls(
            user_id=user_id,
            api_key_id=api_key_id,
            request_json=request_json,
            tracing_enabled=tracing_on,
            spans_on=spans_on,
        )
        if capture.records_traces:
            capture._request_operation = f"{request.method} {request.url.path}"
            authorization = request.headers.get("authorization", "")
            key = request.headers.get("x-api-key")
            if not key and authorization.lower().startswith("bearer "):
                key = authorization[7:].strip()
            capture._secrets = (key,) if key else ()
        return capture

    @property
    def records_traces(self) -> bool:
        return bool(self._user_id and self._tracing_enabled)

    # -- attempt lifecycle --------------------------------------------------

    def begin_attempt(
        self,
        candidate: Any,
        payload: dict[str, Any],
        *,
        stream: bool,
    ) -> Any:
        """Resolves the runtime provider and opens the attempt capture.

        ``candidate`` is a ``routing.RouteCandidate``. Raises GatewayError
        for an unusable provider so the caller can surface it, and returns
        the runtime provider on success.
        """

        self._gateway_model_id = candidate.gateway_model_id
        self._provider_model_id = candidate.provider_model_id
        self._provider_id = candidate.provider_id
        self._upstream_model = candidate.upstream_model
        self._last_payload = payload

        # Raises GatewayError for unknown/disabled provider configuration.
        provider = get_provider(candidate.provider_alias)
        if provider.id != candidate.provider_id or provider.protocol != candidate.protocol:
            raise GatewayError(503, "model_unavailable", "Provider changed during admission")

        if self.records_traces:
            self._provider_operation = f"POST /v1{inference_endpoint(provider.protocol)}"
            secrets = {*self._secrets, provider.api_key, *provider.headers.values()}
            for value in provider.headers.values():
                if value.lower().startswith("bearer "):
                    secrets.add(value[7:].strip())
            self._secrets = tuple(sorted(filter(None, secrets), key=len, reverse=True))
            try:
                self.message_trace_id, self._call_trace_id = (
                    service.start_pending_attempt(
                        user_id=self._user_id,
                        api_key_id=self._api_key_id,
                        request_json=self._request_json,
                        message_trace_id=self.message_trace_id,
                        request_id=self.request_id,
                        gateway_model_id=self._gateway_model_id,
                        provider_model_id=self._provider_model_id,
                    )
                )
            except Exception:  # tracing must never break inference
                self._call_trace_id = None
                logger.exception("Failed to persist pending LLM attempt trace")
        self._span = (
            start_attempt_span(
                provider_name=candidate.provider_alias,
                protocol=provider.protocol,
                model=candidate.upstream_model,
                requested_model=getattr(candidate, "requested_model", None),
                stream=stream,
            )
            if self._spans_on
            else None
        )

        return provider

    def _telemetry_usage(
        self, usage: TokenUsage | None
    ) -> dict[str, int | None]:
        usage = usage or TokenUsage()
        return {
            "input_tokens": canonical_input_tokens(usage),
            "output_tokens": usage.output,
            "cache_tokens": total_cache_tokens(usage),
        }

    def _finish(
        self,
        *,
        status: str,
        error_code: str | None,
        latency_ms: int,
        message_id: str | None = None,
        usage: TokenUsage | None = None,
        error: BaseException | None = None,
        gateway_status: int | None = None,
    ) -> None:
        try:
            finish_attempt_span(
                self._span,
                status_name=status,
                error_code=error_code,
                latency_ms=latency_ms,
                usage=self._telemetry_usage(usage),
                message_id=message_id,
            )
        except Exception:  # telemetry must never break inference
            logger.exception("Failed to finalize LLM attempt span")
        self._span = None

        if not self.records_traces:
            return  # nothing persistable for this context

        telemetry_usage = self._telemetry_usage(usage)
        call_trace_id = self._call_trace_id
        self._call_trace_id = None

        try:
            error_details = None
            if error is not None:
                error_details = {
                    "operation": self._provider_operation or self._request_operation,
                    "upstream_model": self._upstream_model,
                }
                if isinstance(error, GatewayError):
                    error_details.update(
                        message=error.message,
                        provider_status=error.provider_status,
                        gateway_status=gateway_status,
                    )
                    if error.provider_response is not None:
                        error_details.update(
                            provider_error_details(error.provider_response, secrets=self._secrets)
                        )
            if call_trace_id is not None:
                service.finish_pending_attempt(
                    call_trace_id=call_trace_id,
                    status=status,
                    error_code=error_code,
                    error_details=error_details,
                    latency_ms=latency_ms,
                    message_id=message_id,
                    input_tokens=telemetry_usage["input_tokens"],
                    output_tokens=telemetry_usage["output_tokens"],
                    cache_tokens=telemetry_usage["cache_tokens"],
                    uncached_input_tokens=usage.uncached_input if usage else None,
                    cache_read_tokens=usage.cache_read if usage else None,
                    cache_write_tokens=usage.cache_write if usage else None,
                    finished_at=_utcnow(),
                )
            else:
                # Fallback for failures before any attempt row was created
                # (routing or resolution errors): record the attempt directly.
                self.message_trace_id = service.record_attempt(
                    user_id=self._user_id,
                    api_key_id=self._api_key_id,
                    message_trace_id=self.message_trace_id,
                    message_id=message_id,
                    request_id=self.request_id,
                    request_json=self._request_json,
                    gateway_model_id=self._gateway_model_id,
                    provider_model_id=self._provider_model_id,
                    input_tokens=telemetry_usage["input_tokens"],
                    output_tokens=telemetry_usage["output_tokens"],
                    cache_tokens=telemetry_usage["cache_tokens"],
                    uncached_input_tokens=usage.uncached_input if usage else None,
                    cache_read_tokens=usage.cache_read if usage else None,
                    cache_write_tokens=usage.cache_write if usage else None,
                    latency_ms=latency_ms,
                    status=status,
                    error_code=error_code,
                    error_details=error_details,
                    created_at=_utcnow(),
                    finished_at=_utcnow(),
                )
        except Exception:  # tracing must never break inference
            logger.exception("Failed to persist LLM usage trace")

    # -- recording ----------------------------------------------------------

    def success(
        self,
        response_json: dict[str, Any],
        *,
        protocol: str = "openai",
    ) -> None:
        raw_usage = response_json.get("usage")
        raw_usage = raw_usage if isinstance(raw_usage, dict) else {}
        usage = normalize_provider_usage(raw_usage, protocol)
        message_id = _message_id_from_response(response_json)
        self._finish(
            status=service.STATUS_SUCCESS,
            error_code=None,
            latency_ms=_elapsed_ms(self._started),
            message_id=message_id,
            usage=usage,
        )

    def failure(self, error: BaseException) -> None:
        status, error_code = _failure_status(error, "internal_error")
        self._finish(
            status=status,
            error_code=error_code,
            latency_ms=_elapsed_ms(self._started),
            error=error,
            gateway_status=error.status_code if isinstance(error, GatewayError) else None,
        )

    def stream_done(
        self,
        *,
        raw_usage: dict[str, Any] | None = None,
        error: BaseException | None = None,
        message_id: str | None = None,
    ) -> None:
        latency_ms = _elapsed_ms(self._started)
        raw_usage = raw_usage or {}
        protocol = self._stream_protocol
        usage = (
            normalize_provider_usage(raw_usage, protocol)
            if protocol and raw_usage
            else None
        )

        if error is None:
            status, error_code = service.STATUS_SUCCESS, None
        else:
            status, error_code = _failure_status(error, "stream_error")

        self._finish(
            status=status,
            error_code=error_code,
            latency_ms=latency_ms,
            message_id=message_id,
            usage=usage,
            error=error,
        )


def _message_id_from_response(response: dict[str, Any]) -> str | None:
    message_id = response.get("id")
    return message_id if isinstance(message_id, str) and message_id else None


def start_capture(request: Any, payload: Any) -> CallCapture:
    """Open the capture for one inbound gateway request."""

    return CallCapture.start(request, payload)


# ---------------------------------------------------------------------------
# Stream monitoring
# ---------------------------------------------------------------------------


def monitor_stream(
    events: AsyncIterator[Any],
    capture: CallCapture,
    *,
    protocol: str | None = None,
    provider_status: int | None = None,
) -> AsyncIterator[Any]:
    """Yield untouched stream pieces while extracting usage for the attempt.

    ``protocol`` is the protocol of the streamed events: ``"anthropic"``
    extracts input tokens from ``message_start`` and output from
    ``message_delta``, ``"openai"`` reads each chunk's ``usage`` object, and
    ``None`` only measures latency (converted stream shapes without raw
    provider usage).
    """

    capture._stream_protocol = protocol

    async def wrapped() -> AsyncIterator[Any]:
        raw_usage: dict[str, Any] = {}
        message_id: str | None = None
        error: BaseException | None = None
        completed = False

        try:
            async for piece in events:
                if isinstance(piece, dict):
                    if protocol == "anthropic":
                        event_type = piece.get("type") or piece.get("event")

                        if event_type == "message_start":
                            message = piece.get("message") or {}
                            if isinstance(message.get("id"), str) and message.get("id"):
                                message_id = message["id"]
                            start_usage = message.get("usage")
                            if isinstance(start_usage, dict):
                                raw_usage.update(start_usage)

                        elif event_type == "message_delta":
                            delta_usage = piece.get("usage")
                            if isinstance(delta_usage, dict):
                                raw_usage.update(delta_usage)

                    elif protocol == "openai" and isinstance(piece.get("usage"), dict):
                        raw_usage.update(piece["usage"])

                    if error is None and (
                        piece.get("error") or "error" in (piece.get("type"), piece.get("event"))
                    ):
                        error = GatewayError(
                            502,
                            "upstream_error",
                            "Provider reported a stream error",
                            provider_status=provider_status,
                            provider_response=piece.copy() if capture.records_traces else None,
                        )
                    terminal = piece.get("done") or piece.get("type") == "message_stop"
                    if terminal and not completed:
                        await run_in_threadpool(capture.stream_done,
                            raw_usage=raw_usage, error=error, message_id=message_id
                        )
                        completed = True

                yield piece
        except BaseException as exc:  # noqa: BLE001 - re-raised below
            if error is None:
                if isinstance(exc, httpx.TimeoutException):
                    error = GatewayError(
                        504, "upstream_timeout", "Provider stream timed out",
                        provider_status=provider_status,
                    )
                elif isinstance(exc, httpx.HTTPError):
                    error = GatewayError(
                        502, "stream_error", "Connection to the provider ended during streaming",
                        provider_status=provider_status,
                    )
                else:
                    error = exc
            raise
        finally:
            if not completed:
                if error is None and protocol is not None:
                    error = GatewayError(
                        502,
                        "incomplete_stream",
                        "Provider stream ended without a completion event",
                        provider_status=provider_status,
                    )
                await run_in_threadpool(capture.stream_done,
                    raw_usage=raw_usage, error=error, message_id=message_id
                )

    return wrapped()
