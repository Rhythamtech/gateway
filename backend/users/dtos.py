from pydantic import BaseModel, ConfigDict, EmailStr

from backend.auth.models import UserRole


class CurrentUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    role: UserRole
    is_active: bool


class UserUpdateRequest(BaseModel):
    is_active: bool
