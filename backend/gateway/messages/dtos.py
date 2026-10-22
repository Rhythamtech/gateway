from typing import Any

from pydantic import BaseModel, ConfigDict


class AnthropicMessageRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    max_tokens: int
    stream: bool = False


class AnthropicMessageResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    role: str
    model: str
