"""Operational observability via OpenTelemetry (see service.py)."""

from backend.telemetry.middleware import TelemetryMiddleware
from backend.telemetry.service import (
    finish_attempt_span,
    setup,
    shutdown,
    start_attempt_span,
)

__all__ = [
    "TelemetryMiddleware",
    "finish_attempt_span",
    "setup",
    "shutdown",
    "start_attempt_span",
]
