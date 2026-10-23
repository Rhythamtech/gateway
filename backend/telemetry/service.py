"""Operational observability via OpenTelemetry.

This package wires the standard OTel SDK to the app:

* ``setup``/``shutdown`` manage the tracer provider (exporter + sampler).
* ``TelemetryMiddleware`` (``backend.telemetry.middleware``) starts a request
  span **after** authentication so it can honor the caller's per-user
  ``telemetry_enabled`` opt-out; operator-surface (non ``/v1``) traffic is
  governed by ``TELEMETRY_ENABLED`` alone.
* ``start_attempt``/``finish_attempt`` emit one ``gateway.llm.call`` span per
  upstream provider attempt, used by ``backend.traces.capture``.

Telemetry here is operational and config-driven; it never contains prompt or
completion bodies. The persisted, user-scoped usage records live in
``backend.traces`` (see docs/tracing.md for the split).
"""

import logging
from typing import Any

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ALWAYS_OFF, ALWAYS_ON

from backend.core.config import settings

logger = logging.getLogger(__name__)

_TRACER_NAME = "backend.gateway"
_REQUEST_SPAN = "gateway.request"
# Semantic-convention style attributes for the LLM-call span.
_LLM_CALL = "gateway.llm.call"

_configured = False


def get_tracer() -> trace.Tracer:
    return trace.get_tracer(_TRACER_NAME)


def spans_active() -> bool:
    """True when the SDK is configured and capable of recording spans."""

    return _configured


def setup(app: Any = None) -> None:
    """Configure the SDK. The ``app`` argument is no longer instrumented
    automatically — request spans are created by ``TelemetryMiddleware``."""

    global _configured
    if not settings.TELEMETRY_ENABLED or _configured:
        return

    provider = TracerProvider(
        resource=Resource.create({"service.name": settings.OTEL_SERVICE_NAME}),
        sampler=ALWAYS_OFF if settings.OTEL_SAMPLER == "always_off" else ALWAYS_ON,
    )

    # Without an exporter endpoint spans stay in-process (useful for a local
    # SDK with a custom processor only); a real collector needs the endpoint.
    if settings.OTLP_EXPORTER_ENDPOINT:
        provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.OTLP_EXPORTER_ENDPOINT))
        )
    else:
        logger.warning(
            "TELEMETRY_ENABLED without OTLP_EXPORTER_ENDPOINT: spans are recorded "
            "but not exported anywhere."
        )

    trace.set_tracer_provider(provider)
    _configured = True
    logger.info("OpenTelemetry instrumentation enabled")


def shutdown() -> None:
    """Flush the provider when the app stops."""

    global _configured
    if not _configured:
        return

    provider = trace.get_tracer_provider()
    shutdown_attr = getattr(provider, "shutdown", None)

    if shutdown_attr:
        try:
            shutdown_attr()
        except Exception:  # telemetry shutdown must never break the app
            logger.exception("Failed to shut down OpenTelemetry tracer provider")

    _configured = False


# ---------------------------------------------------------------------------
# Request spans (middleware level)
# ---------------------------------------------------------------------------


def start_request_span(*, method: str, path: str, authenticated: bool) -> trace.Span | None:
    """Open a request span; ``None`` when telemetry is unavailable."""

    if not _configured:
        return None

    span = get_tracer().start_span(_REQUEST_SPAN)
    span.set_attribute("http.method", method)
    span.set_attribute("http.path", path)
    span.set_attribute("gateway.authenticated", authenticated)
    return span


def finish_request_span(
    span: Any,
    *,
    status_code: int | None = None,
    error: BaseException | None = None,
) -> None:
    """Close a request span with its outcome."""

    if span is None:
        return

    if status_code is not None:
        span.set_attribute("http.status_code", status_code)
        if status_code >= 500:
            span.set_status(trace.Status(trace.StatusCode.ERROR))
        elif status_code < 400:
            span.set_status(trace.Status(trace.StatusCode.OK))

    if error is not None:
        span.record_exception(error)
        span.set_status(trace.Status(trace.StatusCode.ERROR, str(error)))

    span.end()


# ---------------------------------------------------------------------------
# LLM attempt spans (capture level)
# ---------------------------------------------------------------------------


def start_attempt_span(
    *,
    provider_name: str,
    protocol: str,
    model: str,
    requested_model: str | None,
    stream: bool,
) -> trace.Span | None:
    """Open one span per upstream provider attempt; None when disabled."""

    if not _configured:
        return None

    span = get_tracer().start_span(_LLM_CALL)
    span.set_attribute("gateway.provider", provider_name)
    span.set_attribute("gateway.protocol", protocol)
    span.set_attribute("gen_ai.request.model", model)
    if requested_model:
        span.set_attribute("gateway.requested_model", requested_model)
    span.set_attribute("gateway.stream", stream)
    return span


def finish_attempt_span(
    span: Any,
    *,
    status_name: str,
    error_code: str | None,
    latency_ms: int,
    usage: dict[str, Any],
    message_id: str | None,
) -> None:
    """Close an attempt span with outcome, latency and provider-reported usage."""

    if span is None:
        return

    span.set_attribute("gateway.attempt.status", status_name)
    span.set_attribute("gateway.latency_ms", latency_ms)

    if error_code:
        span.set_attribute("gateway.error_code", error_code)
        span.set_status(trace.Status(trace.StatusCode.ERROR, error_code))
    else:
        span.set_status(trace.Status(trace.StatusCode.OK))

    for key, attribute in (
        ("gen_ai.usage.input_tokens", "input_tokens"),
        ("gen_ai.usage.output_tokens", "output_tokens"),
        ("gateway.usage.cache_tokens", "cache_tokens"),
    ):
        value = usage.get(attribute)
        if isinstance(value, int) and value >= 0:
            span.set_attribute(key, value)

    if message_id:
        span.set_attribute("gateway.message_id", message_id)

    span.end()
