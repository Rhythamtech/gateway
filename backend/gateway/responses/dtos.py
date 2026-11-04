from pydantic import BaseModel, ConfigDict, Field


class ResponsesRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    stream: bool = False
    max_output_tokens: int | None = Field(default=None, gt=0, le=1_000_000, strict=True)


class ResponsesResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    object: str
    status: str
    model: str
