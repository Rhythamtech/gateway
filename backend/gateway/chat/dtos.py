from typing import Any

from pydantic import BaseModel, ConfigDict


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    stream: bool = False


class ChatCompletionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    object: str
    created: int
    model: str
