from pydantic import BaseModel, ConfigDict, EmailStr, Field

from backend.auth.models import UserRole


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class SignupSettings(BaseModel):
    signups_enabled: bool
    block_disposable_emails: bool


class SignupSettingsUpdate(BaseModel):
    signups_enabled: bool | None = None
    block_disposable_emails: bool | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    role: UserRole
    is_active: bool
