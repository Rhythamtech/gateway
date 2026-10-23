"""Capture of one inbound gateway request across its provider attempt.

One ``CallCapture`` per inbound message/request:

* the sanitized request payload is stored once (``llm_message_traces``),
* the actual upstream attempt is recorded (``llm_call_traces``) — including
  routing decisions, failures and timeouts — and daily aggregates are updated
  in the same transaction as the call trace,
* the same attempt also emits one OpenTelemetry ``gateway.llm.call`` span
  (config-driven, independent of the per-user opt-in below).

Per-user persistence is opt-in: middleware stamps ``request.state
.tracing_enabled`` from the API key owner's ``users.tracing_enabled`` flag.
OpenTelemetry spans are also opt-in per user (``users.telemetry_enabled``,
toggled by the user themselves); source traffic with the flag off emits no
request span and no LLM span. Capture must never break inference — every
recording path swallows its own errors.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from opentelemetry.trace import Span

from backend.core.database import SessionLocal
from backend.core.errors import GatewayError
from backend.gateway.model_groups.models import ModelGroup
from backend.gateway.provider_models.models import ProviderModel
from backend.telemetry import finish_attempt_span, start_attempt_span
from backend.traces import service
from backend.traces.redaction import serialize_request_payload

logger = logging.getLogger(__name__)

# Provider timeout errors recorded as the timeout attempt status.
_TIMEOUT_ERROR_CODES = ("upstream_timeout", "request_timeout")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 0 else None


def extract_usage(response: dict[str, Any], protocol: str) -> dict[str, Any]:
    """Provider-reported token usage; absent values stay unavailable (None)."""

    usage = response.get("usage") or {}

    if protocol == "anthropic":
        return {
            "input_tokens": _int_or_none(usage.get("input_tokens")),
            "output_tokens": _int_or_none(usage.get("output_tokens")),
            "cache_tokens": _int_or_none(usage.get("cache_read_input_tokens")),
        }

    prompt_details = usage.get("prompt_tokens_details") or {}
    return {
        "input_tokens": _int_or_none(usage.get("prompt_tokens")),
        "output_tokens": _int_or_none(usage.get("completion_tokens")),
        "cache_tokens": _int_or_none(prompt_details.get("cached_tokens")),
    }


def message_id_from_response(response: dict[str, Any]) -> str | None:
    message_id = response.get("id")
    return message_id if isinstance(message_id, str) and message_id else None


def _elapsed_ms(started: float) -> int:
    return max(0, int(round((time.monotonic() - started) * 1000)))


def _failure_status(error: Exception, default_error_code: str) -> tuple[str, str]:
    """Map a capture failure to its (attempt status, error_code) pair."""

    status = service.STATUS_FAILED
    error_code = default_error_code

    if isinstance(error, GatewayError):
        error_code = error.code
        if error.code in _TIMEOUT_ERROR_CODES:
            status = service.STATUS_TIMEOUT

    return status, error_code


def _start_of(moment: datetime, latency_ms: int) -> datetime:
    seconds = latency_ms / 1000
    return datetime.fromtimestamp(moment.timestamp() - seconds, tz=timezone.utc)


class CallCapture:
    """Records the request context, the provider attempt and daily aggregates."""

    def __init__(
        self,
        *,
        user_id: str | None,
        api_key_id: str | None,
        request_json: str | None,
        spans_on: bool = False,
    ):
        self._user_id = user_id
        self._api_key_id = api_key_id
        self._request_json = request_json
        self._spans_on = spans_on
        self._span: Span | None = None
        self._started = time.monotonic()
        self._gateway_model_id: str | None = None
        self._provider_model_id: str | None = None
        self.message_trace_id: str | None = None

    @classmethod
    def start(cls, request: Any, payload: Any) -> "CallCapture":
        user_id = getattr(request.state, "api_key_owner_id", None)
        api_key_id = getattr(request.state, "api_key_id", None)
        enabled = getattr(request.state, "tracing_enabled", False)
        persist = bool(enabled and user_id and api_key_id)
        # Spans carry the key owner's own opt-out (see docs/tracing.md).
        spans_on = bool(getattr(request.state, "telemetry_enabled", False))

        return cls(
            user_id=user_id if persist else None,
            api_key_id=api_key_id if persist else None,
            request_json=serialize_request_payload(payload) if persist else None,
            spans_on=spans_on,
        )

    # -- attempt -----------------------------------------------------------

    def attempt(
        self,
        provider_name: str,
        upstream_model: str,
        requested_model: str | None,
        *,
        protocol: str,
        stream: bool,
    ) -> None:
        """Resolve gateway/provider model entities and open the attempt span."""

        # The resolved ids back persisted trace rows only; a non-opted-in user
        # skips the lookups entirely.
        self._gateway_model_id = None
        self._provider_model_id = None

        if self._user_id:
            db = SessionLocal()
            try:
                provider_model = (
                    db.query(ProviderModel)
                    .filter(ProviderModel.model_id == f"{provider_name}/{upstream_model}")
                    .first()
                )
                self._provider_model_id = provider_model.id if provider_model else None

                group = None
                if requested_model:
                    group = (
                        db.query(ModelGroup)
                        .filter(ModelGroup.model_id == requested_model)
                        .first()
                    )
                self._gateway_model_id = group.id if group else None
            finally:
                db.close()

        self._span = (
            start_attempt_span(
                provider_name=provider_name,
                protocol=protocol,
                model=upstream_model,
                requested_model=requested_model,
                stream=stream,
            )
            if self._spans_on
            else None
        )

    # -- recording ---------------------------------------------------------

    def _record(
        self,
        *,
        status: str,
        error_code: str | None,
        latency_ms: int,
        input_tokens: int | None,
        output_tokens: int | None,
        cache_tokens: int | None,
        message_id: str | None,
    ) -> None:
        try:
            finish_attempt_span(
                self._span,
                status_name=status,
                error_code=error_code,
                latency_ms=latency_ms,
                usage={
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_tokens": cache_tokens,
                },
                message_id=message_id,
            )
        except Exception:  # telemetry must never break inference
            logger.exception("Failed to finalize LLM attempt span")
        self._span = None

        if not self._user_id:
            return  # persistence is opt-in; OTel span still closed above

        try:
            self.message_trace_id = service.record_attempt(
                user_id=self._user_id,
                api_key_id=self._api_key_id,
                message_trace_id=self.message_trace_id,
                message_id=message_id,
                request_json=self._request_json,
                gateway_model_id=self._gateway_model_id,
                provider_model_id=self._provider_model_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_tokens=cache_tokens,
                latency_ms=latency_ms,
                status=status,
                error_code=error_code,
                created_at=_start_of(_utcnow(), latency_ms),
                finished_at=_utcnow(),
            )
        except Exception:  # tracing must never break inference
            logger.exception("Failed to persist LLM usage trace")

    def success(
        self,
        response_json: dict[str, Any],
        *,
        protocol: str = "openai",
    ) -> None:
        usage = extract_usage(response_json, protocol)
        latency_ms = _elapsed_ms(self._started)

        self._record(
            status=service.STATUS_SUCCESS,
            error_code=None,
            latency_ms=latency_ms,
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            cache_tokens=usage["cache_tokens"],
            message_id=message_id_from_response(response_json),
        )

    def failure(self, error: Exception) -> None:
        status, error_code = _failure_status(error, "internal_error")
        latency_ms = _elapsed_ms(self._started)

        self._record(
            status=status,
            error_code=error_code,
            latency_ms=latency_ms,
            input_tokens=None,
            output_tokens=None,
            cache_tokens=None,
            message_id=None,
        )

    def stream_done(
        self,
        *,
        usage: dict[str, Any] | None = None,
        error: BaseException | None = None,
        message_id: str | None = None,
    ) -> None:
        latency_ms = _elapsed_ms(self._started)
        tokens = usage or {}

        if error is None:
            status, error_code = service.STATUS_SUCCESS, None
        else:
            status, error_code = _failure_status(error, "stream_error")

        self._record(
            status=status,
            error_code=error_code,
            latency_ms=latency_ms,
            input_tokens=tokens.get("input_tokens"),
            output_tokens=tokens.get("output_tokens"),
            cache_tokens=tokens.get("cache_tokens"),
            message_id=message_id,
        )


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
) -> AsyncIterator[Any]:
    """Yield untouched stream pieces while extracting usage for the attempt.

    ``protocol`` is the protocol of the streamed events: ``"anthropic"``
    extracts input tokens from ``message_start`` and output from
    ``message_delta``, ``"openai"`` reads each chunk's ``usage`` object, and
    ``None`` only measures latency (converted stream shapes without raw
    provider usage).
    """

    usage: dict[str, Any] = {}
    message_id: str | None = None

    async def wrapped() -> AsyncIterator[Any]:
        error: BaseException | None = None
        try:
            async for piece in events:
                if isinstance(piece, dict):
                    if protocol == "anthropic":
                        event_type = piece.get("type") or piece.get("event")

                        if event_type == "message_start":
                            message = piece.get("message") or {}
                            if isinstance(message.get("id"), str) and message.get("id"):
                                message_id = message["id"]
                            observed = _int_or_none((message.get("usage") or {}).get("input_tokens"))
                            if observed is not None:
                                usage["input_tokens"] = observed

                        elif event_type == "message_delta":
                            observed = _int_or_none((piece.get("usage") or {}).get("output_tokens"))
                            if observed is not None:
                                usage["output_tokens"] = observed

                    elif protocol == "openai" and isinstance(piece.get("usage"), dict):
                        observed = extract_usage(piece, "openai")
                        for key, value in observed.items():
                            if value is not None:
                                usage[key] = value

                yield piece
        except BaseException as exc:  # noqa: BLE001 - re-raised below
            error = exc
            raise
        finally:
            capture.stream_done(usage=usage, error=error, message_id=message_id)

    return wrapped()
