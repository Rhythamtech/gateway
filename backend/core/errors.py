"""Shared gateway exceptions.

Error responses are shaped per request path in ``backend.main``; this module
only carries the exception type the data plane raises so provider/controller
code never touches ``fastapi.HTTPException`` directly.
"""


class GatewayError(Exception):
    """Gateway-side failure carrying wire status, code and message."""

    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)
