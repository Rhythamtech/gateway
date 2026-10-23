"""Capture of one inbound gateway request across its provider attempt.

One ``CallCapture`` per inbound message/request:

* the sanitized request payload is stored once (``llm_message_traces``),
* every actual upstream attempt gets its own ``pending`` call trace and
  wallet reservation before dispatch, and is settled (usage, charges,
  reservation release) or released right after — in the recording
  transaction of that attempt,
* the same attempt also emits one OpenTelemetry ``gateway.llm.call`` span
  (config-driven, independent of the per-user opt-in below).

Request payloads are persisted only for users that opted into tracing
(``users.tracing_enabled``); usage and billing metadata is always recorded
because it is required for accounting. Capture must never break inference —
every recording path swallows its own errors at ``ERROR`` level.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from opentelemetry.trace import Span

from backend.core.errors import GatewayError
from backend.gateway.providers.service import get_provider
from backend.telemetry import finish_attempt_span, start_attempt_span
from backend.traces import service
from backend.traces.redaction import serialize_request_payload
from backend.wallet import service as wallet_service
from backend.wallet.service import (
    TokenUsage,
    approximate_input_tokens,
    canonical_input_tokens,
    normalize_provider_usage,
    requested_output_tokens,
    sanitize_usage_json,
    total_cache_tokens,
)

logger = logging.getLogger(__name__)

# Provider timeout errors recorded as the timeout attempt status.
_TIMEOUT_ERROR_CODES = ("upstream_timeout", "request_timeout")
# Connection-stage failures: nothing was dispatched and no tokens were
# consumed, so the reservation is released instead of billed.
_NO_DISPATCH_CODES = ("dispatch_failed",)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 0 else None


def _elapsed_ms(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1000))


def _failure_status(error: Exception, default_error_code: str) -> tuple[str, str]:
    """Map a capture failure to its (attempt status, error_code) pair."""

    status = service.STATUS_FAILED
    error_code = default_error_code

    if isinstance(error, GatewayError):
        error_code = error.code
        if error.code in _TIMEOUT_ERROR_CODES:
            status = service.STATUS_TIMEOUT

    return status, error_code


class CallCapture:
    """Records the request context, the provider attempt and its charges."""

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
        self._charge: wallet_service.AttemptCharge | None = None
        self._stream_protocol: str | None = None
        # Attempt references set by begin_attempt; failures that happen
        # before any candidate is reserved (planning/resolution errors)
        # still record without them.
        self._gateway_model_id: str | None = None
        self._provider_model_id: str | None = None
        self._provider_id: str | None = None
        self._upstream_model: str | None = None
        self.message_trace_id: str | None = None

    @classmethod
    def start(cls, request: Any, payload: Any) -> "CallCapture":
        user_id = getattr(request.state, "api_key_owner_id", None)
        api_key_id = getattr(request.state, "api_key_id", None)
        # Billing is always recorded; the sanitized request payload is only
        # persisted when the user opted into trace persistence.
        persist = bool(getattr(request.state, "tracing_enabled", False))
        request_json = serialize_request_payload(payload) if persist else None
        # Spans carry the key owner's own opt-out (see docs/tracing.md).
        spans_on = bool(getattr(request.state, "telemetry_enabled", False))

        return cls(
            user_id=user_id,
            api_key_id=api_key_id,
            request_json=request_json,
            spans_on=spans_on,
        )

    # -- attempt lifecycle --------------------------------------------------

    def begin_attempt(
        self,
        candidate: Any,
        payload: dict[str, Any],
        *,
        stream: bool,
    ) -> Any:
        """Resolves the runtime provider and reserves credits pre-dispatch.

        ``candidate`` is a ``routing.RouteCandidate``. Raises GatewayError
        for an unusable provider (before any reservation) so the caller can
        surface it, and returns the runtime provider on success.
        """

        self._gateway_model_id = candidate.gateway_model_id
        self._provider_model_id = candidate.provider_model_id
        self._provider_id = candidate.provider_id
        self._upstream_model = candidate.upstream_model

        # Raises GatewayError when the provider cannot be used at all
        # (unknown/disabled/configuration); the controller records it and
        # surfaces the wire error. No reservation exists yet.
        provider = get_provider(candidate.provider_alias)

        if not self._user_id:
            return provider  # untraceable context: legacy record path only

        try:
            self._charge = wallet_service.reserve_attempt(
                user_id=self._user_id,
                api_key_id=self._api_key_id,
                provider_id=candidate.provider_id,
                provider_model_id=candidate.provider_model_id,
                gateway_model_id=candidate.gateway_model_id,
                multiplier_ppm=candidate.multiplier_ppm,
                pricing_version=candidate.pricing_version,
                estimate_input_tokens=approximate_input_tokens(payload),
                estimate_output_tokens=requested_output_tokens(payload),
                request_json=self._request_json,
                message_trace_id=self.message_trace_id,
            )
            self.message_trace_id = self._charge.message_trace_id
        except GatewayError:
            # A failed pre-dispatch reservation leaves no charge to settle;
            # user-level errors (insufficient credits, inactive wallet) are
            # surfaced by the controller, budget errors skip the member.
            self._charge = None
            raise

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
        sanitized_usage_json: str | None = None,
        release_without_billing: bool = False,
        allow_estimate: bool = True,
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

        charge = self._charge
        self._charge = None

        if charge is not None and release_without_billing:
            try:
                wallet_service.release_attempt(
                    call_trace_id=charge.call_trace_id,
                    status_name=status,
                    error_code=error_code or "released",
                    latency_ms=latency_ms,
                )
            except Exception:  # billing must never break a served response
                logger.exception("Failed to release attempt %s", charge.call_trace_id)
            return

        if charge is not None:
            try:
                wallet_service.settle_attempt(
                    call_trace_id=charge.call_trace_id,
                    status_name=status,
                    error_code=error_code,
                    latency_ms=latency_ms,
                    message_id=message_id,
                    token_usage=usage,
                    sanitized_usage_json=sanitized_usage_json,
                    allow_estimate=allow_estimate,
                )
            except Exception:  # billing must never break a served response
                logger.exception("Failed to settle attempt %s", charge.call_trace_id)
            return

        if not self._user_id:
            return  # nothing recordable — attempts stayed unrouted

        # Fallback for failures before any member was reserved (routing or
        # resolution errors): record the failed attempt without billing.
        telemetry_usage = self._telemetry_usage(usage)
        try:
            self.message_trace_id = service.record_attempt(
                user_id=self._user_id,
                api_key_id=self._api_key_id,
                message_trace_id=self.message_trace_id,
                message_id=message_id,
                request_json=self._request_json,
                gateway_model_id=self._gateway_model_id,
                provider_model_id=self._provider_model_id,
                input_tokens=telemetry_usage["input_tokens"],
                output_tokens=telemetry_usage["output_tokens"],
                cache_tokens=telemetry_usage["cache_tokens"],
                latency_ms=latency_ms,
                status=status,
                error_code=error_code,
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
        self._finish(
            status=service.STATUS_SUCCESS,
            error_code=None,
            latency_ms=_elapsed_ms(self._started),
            message_id=_message_id_from_response(response_json),
            usage=usage,
            sanitized_usage_json=sanitize_usage_json(raw_usage, protocol),
        )

    def failure(self, error: Exception) -> None:
        status, error_code = _failure_status(error, "internal_error")
        latency_ms = _elapsed_ms(self._started)

        charge = self._charge
        if charge is not None and error_code in _NO_DISPATCH_CODES:
            # Dispatch never happened (connection-stage failure): no provider
            # tokens were consumed, so release the reservation without billing.
            self._finish(
                status=status,
                error_code=error_code,
                latency_ms=latency_ms,
                release_without_billing=True,
            )
            return

        # Dispatched attempt that failed with unknown usage: settle through
        # the configured estimation / unbillable policy. Any reported usage
        # would be reconciled; errors carry none.
        self._finish(
            status=status,
            error_code=error_code,
            latency_ms=latency_ms,
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
        # Converted stream shapes hide raw provider usage from the gateway;
        # they are recorded latency-only and never billed from estimates.
        allow_estimate = protocol is not None
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
            sanitized_usage_json=(
                sanitize_usage_json(raw_usage, protocol) if raw_usage else None
            ),
            allow_estimate=allow_estimate,
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

                yield piece
        except BaseException as exc:  # noqa: BLE001 - re-raised below
            error = exc
            raise
        finally:
            capture.stream_done(raw_usage=raw_usage, error=error, message_id=message_id)

    return wrapped()
