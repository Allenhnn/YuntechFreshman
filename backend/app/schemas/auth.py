import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_PATTERN = r"^[A-Za-z0-9_]{3,20}$"


class GoogleRegisterRequest(BaseModel):
    id_token: str = Field(description="前端 Google Identity Services 取得的 credential（ID token）")
    username: str = Field(pattern=USERNAME_PATTERN, description="3–20 字，英數或底線")
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)

    @field_validator("username")
    @classmethod
    def not_guest_prefix(cls, v: str) -> str:
        v = v.lower()
        if v.startswith("guest_"):
            raise ValueError("使用者名稱不能以 guest_ 開頭")
        return v


class GoogleLoginRequest(BaseModel):
    id_token: str


class LoginRequest(BaseModel):
    username: str = Field(max_length=32)
    password: str = Field(max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    email: str | None
    avatar_url: str | None
    is_guest: bool


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
