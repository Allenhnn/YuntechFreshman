import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_PATTERN = r"^[A-Za-z0-9_]{3,20}$"


def check_username(v: str) -> str:
    """一律存小寫；guest_ 開頭保留給訪客。"""
    v = v.lower()
    if v.startswith("guest_"):
        raise ValueError("使用者名稱不能以 guest_ 開頭")
    return v


def check_display_name(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class RegisterRequest(BaseModel):
    """不用 Google，直接用使用者名稱 + 密碼註冊。"""

    username: str = Field(pattern=USERNAME_PATTERN, description="3–20 字，英數或底線")
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        return check_username(v)

    @field_validator("display_name")
    @classmethod
    def _display_name(cls, v: str | None) -> str | None:
        return check_display_name(v)


class GoogleRegisterRequest(RegisterRequest):
    """舊流程：Google 驗證後再設定帳密（仍保留給 /auth-test 測試頁）。"""

    id_token: str = Field(description="前端 Google Identity Services 取得的 credential（ID token）")


class GoogleLoginRequest(BaseModel):
    id_token: str


class LoginRequest(BaseModel):
    username: str = Field(max_length=32)
    password: str = Field(max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class UpdateMeRequest(BaseModel):
    """設定頁修改帳戶名稱；沒給的欄位不變。"""

    display_name: str | None = Field(default=None, max_length=64)
    username: str | None = Field(default=None, pattern=USERNAME_PATTERN)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str | None) -> str | None:
        return None if v is None else check_username(v)

    @field_validator("display_name")
    @classmethod
    def _display_name(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("顯示名稱不能空白")
        return check_display_name(v)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    email: str | None
    avatar_url: str | None
    is_guest: bool
    has_password: bool = False
    has_google: bool = False


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
