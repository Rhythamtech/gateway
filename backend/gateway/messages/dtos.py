from pydantic import BaseModel, ConfigDict, Field


class AnthropicMessageRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    max_tokens: int | None = Field(default=None, gt=0, le=1_000_000, strict=True)
    stream: bool = False


class AnthropicMessageResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    role: str
    model: str
