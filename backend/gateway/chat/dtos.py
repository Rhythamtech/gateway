from pydantic import BaseModel, ConfigDict, Field


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    stream: bool = False
    max_tokens: int | None = Field(default=None, gt=0, le=1_000_000, strict=True)
    max_completion_tokens: int | None = Field(
        default=None, gt=0, le=1_000_000, strict=True
    )


class ChatCompletionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    object: str
    created: int
    model: str
