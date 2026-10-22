from typing import Any

from pydantic import BaseModel, ConfigDict


class ResponsesRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    stream: bool = False


class ResponsesResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    object: str
    status: str
    model: str
