from fastapi import APIRouter, Depends, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.api.deps import get_client_info, get_current_user, get_optional_user
from app.db.database import get_db
from app.db.redis import get_redis
from app.models import User
from app.schemas.auth import (
    GoogleLoginRequest,
    GoogleRegisterRequest,
    LoginRequest,
    RegisterRequest,
    UpdateMeRequest,
    RefreshRequest,
    TokenResponse,
    UserOut,
)
from app.services import auth as auth_service
from app.services.auth import ClientInfo
from app.services.google import verify_google_id_token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register/google", response_model=TokenResponse, status_code=status.HTTP_201_CREATED,
             summary="1. 用 Google 註冊（同時設定使用者名稱與密碼）")
async def register_google(
    body: GoogleRegisterRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    client: ClientInfo = Depends(get_client_info),
    current: User | None = Depends(get_optional_user),
):
    """帶訪客的 Authorization header 呼叫時，會把該訪客升級成正式帳號並保留進度。"""
    profile = await verify_google_id_token(body.id_token)
    return await auth_service.register_with_google(db, redis, body, profile, client, guest=current)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED,
             summary="1b. 使用者名稱 + 密碼註冊（不用 Google）")
async def register(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    client: ClientInfo = Depends(get_client_info),
    current: User | None = Depends(get_optional_user),
):
    """帶訪客的 Authorization header 呼叫時，會把該訪客升級成正式帳號並保留進度。"""
    return await auth_service.register_with_password(db, redis, body, client, guest=current)


@router.post("/login", response_model=TokenResponse, summary="2. 使用者名稱 + 密碼登入")
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    client: ClientInfo = Depends(get_client_info),
):
    return await auth_service.login_with_password(db, redis, body.username, body.password, client)


@router.post("/login/google", response_model=TokenResponse,
             summary="2b. Google 一鍵登入；第一次使用會自動註冊並登入")
async def login_google(
    body: GoogleLoginRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    client: ClientInfo = Depends(get_client_info),
    current: User | None = Depends(get_optional_user),
):
    """帶訪客的 Authorization header 且這個 Google 帳號還沒註冊時，會把訪客升級並保留進度。"""
    profile = await verify_google_id_token(body.id_token)
    return await auth_service.login_with_google(db, redis, profile, client, guest=current)


@router.post("/guest", response_model=TokenResponse, status_code=status.HTTP_201_CREATED,
             summary="3. 訪客登入")
async def guest_login(
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    client: ClientInfo = Depends(get_client_info),
):
    return await auth_service.login_as_guest(db, redis, client)


@router.post("/refresh", response_model=TokenResponse, summary="用 refresh token 換新 token")
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db),
                  redis: Redis = Depends(get_redis)):
    return await auth_service.refresh_tokens(db, redis, body.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="登出")
async def logout(body: RefreshRequest, redis: Redis = Depends(get_redis)):
    await auth_service.logout(redis, body.refresh_token)


@router.get("/me", response_model=UserOut, summary="目前登入的使用者")
async def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut, summary="修改顯示名稱 / 使用者名稱")
async def update_me(
    body: UpdateMeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.update_me(db, user, body)


@router.get("/config", summary="前端需要的公開設定（Google Client ID）")
async def public_config():
    return {"google_client_id": get_settings().google_client_id}
