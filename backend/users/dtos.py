from pydantic import BaseModel, ConfigDict, EmailStr

from backend.auth.models import UserRole


class CurrentUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    role: UserRole
    is_active: bool
    # Persisted /traces recording opt-in (toggled by a superuser).
    tracing_enabled: bool
    # OpenTelemetry span opt-in (toggled by the user themselves).
    telemetry_enabled: bool


class UserUpdateRequest(BaseModel):
    is_active: bool | None = None
    tracing_enabled: bool | None = None


class UserPreferencesUpdate(BaseModel):
    telemetry_enabled: bool
