"""Shared gateway exceptions.

Error responses are shaped per request path in ``backend.main``; this module
only carries the exception type the data plane raises so provider/controller
code never touches ``fastapi.HTTPException`` directly.
"""


class GatewayError(Exception):
    """Gateway-side failure carrying wire status, code and message."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        provider_status: int | None = None,
        provider_response: object = None,
        automatic_tool_choice_rejected: bool = False,
    ):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.provider_status = provider_status
        self.provider_response = provider_response
        self.automatic_tool_choice_rejected = automatic_tool_choice_rejected
        super().__init__(message)


def model_not_found(model: str) -> GatewayError:
    return GatewayError(
        404, "model_not_found",
        f"The model '{model}' does not exist or has been removed from the API.",
    )


REQUEST_TIMEOUT_SECONDS = 300
REQUEST_TIMEOUT_MESSAGE = "The request exceeded the five-minute time limit."


def request_timeout() -> GatewayError:
    return GatewayError(504, "request_timeout", REQUEST_TIMEOUT_MESSAGE)
