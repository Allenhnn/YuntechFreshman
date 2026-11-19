import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    create_access_token,
    hash_password,
    hash_token,
    new_refresh_token,
    verify_password,
)
from app.models import LoginLog, OAuthAccount, User
from app.schemas.auth import GoogleRegisterRequest, RegisterRequest, TokenResponse, UpdateMeRequest, UserOut
from app.services.google import GoogleProfile


@dataclass
class ClientInfo:
    ip: str | None
    user_agent: str | None


# ---------- Redis keys ----------
def _refresh_key(token: str) -> str:
    return f"auth:refresh:{hash_token(token)}"


def _login_fail_key(username: str) -> str:
    return f"auth:login_fail:{username}"


def _guest_rate_key(ip: str) -> str:
    return f"auth:guest_rate:{ip}"


# ---------- 共用 ----------
def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _issue_tokens(redis: Redis, user: User) -> TokenResponse:
    s = get_settings()
    refresh = new_refresh_token()
    await redis.set(_refresh_key(refresh), str(user.id), ex=s.refresh_token_expire_days * 86400)
    return TokenResponse(
        access_token=create_access_token(user.id, user.is_guest),
        refresh_token=refresh,
        user=UserOut.model_validate(user),
    )


def _log(db: AsyncSession, client: ClientInfo, method: str, success: bool,
         user_id: uuid.UUID | None = None, username: str | None = None) -> None:
    db.add(LoginLog(
        user_id=user_id, method=method, success=success, username_attempted=username,
        ip_address=client.ip, user_agent=(client.user_agent or "")[:512] or None,
    ))


# ---------- 1. Google 註冊 ----------
async def register_with_google(
    db: AsyncSession, redis: Redis, body: GoogleRegisterRequest, profile: GoogleProfile,
    client: ClientInfo, guest: User | None = None,
) -> TokenResponse:
    """用 Google 驗證身分並設定帳密。若帶著訪客 token，直接把該訪客升級成正式帳號（保留遊戲進度）。"""
    linked = await db.scalar(select(OAuthAccount).where(
        OAuthAccount.provider == "google", OAuthAccount.provider_user_id == profile.sub))
    if linked:
        raise HTTPException(status.HTTP_409_CONFLICT, "此 Google 帳號已註冊，請直接登入")
    if await db.scalar(select(User.id).where(User.username == body.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "使用者名稱已被使用")
    if await db.scalar(select(User.id).where(User.email == profile.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "此 email 已被其他帳號使用")

    if guest is not None and guest.is_guest:
        user = guest  # 升級訪客：同一筆 row，id 不變
        user.is_guest = False
    else:
        user = User()
        db.add(user)
    user.username = body.username
    user.email = profile.email
    user.password_hash = hash_password(body.password)
    user.display_name = body.display_name or profile.name or body.username
    user.avatar_url = profile.picture
    user.last_login_at = _now()
    user.oauth_accounts.append(
        OAuthAccount(provider="google", provider_user_id=profile.sub, email=profile.email))

    try:
        await db.flush()
        _log(db, client, "register", True, user.id, body.username)
        await db.commit()
    except IntegrityError:  # 同時有人搶同一個 username/email
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "使用者名稱或 Google 帳號已被使用")
    await db.refresh(user)
    return await _issue_tokens(redis, user)


# ---------- 1b. 帳號密碼註冊（不用 Google） ----------
async def register_with_password(
    db: AsyncSession, redis: Redis, body: RegisterRequest, client: ClientInfo, guest: User | None = None,
) -> TokenResponse:
    """沒有或不想用 Google 帳號時直接註冊。帶著訪客 token 時把該訪客升級（保留遊戲進度）。"""
    if await db.scalar(select(User.id).where(User.username == body.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "使用者名稱已被使用")
    if guest is not None and guest.is_guest:
        user = guest
        user.is_guest = False
    else:
        user = User()
        db.add(user)
    user.username = body.username
    user.password_hash = hash_password(body.password)
    user.display_name = body.display_name or body.username
    user.last_login_at = _now()
    try:
        await db.flush()
        _log(db, client, "register", True, user.id, body.username)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "使用者名稱已被使用")
    await db.refresh(user)
    return await _issue_tokens(redis, user)


async def _free_username(db: AsyncSession, profile: GoogleProfile) -> str:
    """Google 自動註冊時的使用者名稱：取 email @ 前面，整理成 3–20 個英數底線，撞名就加數字。"""
    base = re.sub(r"[^a-z0-9_]", "_", profile.email.split("@")[0].lower()).strip("_")[:16]
    if base.startswith("guest_"):
        base = "g" + base
    if len(base) < 3:
        base = f"user_{base}".strip("_")
    candidates = [base] + [f"{base}{n}" for n in range(2, 100)]
    for name in candidates:
        if not await db.scalar(select(User.id).where(User.username == name)):
            return name
    return f"{base[:11]}_{secrets.token_hex(4)}"


# ---------- 2a. 帳號密碼登入 ----------
async def login_with_password(
    db: AsyncSession, redis: Redis, username: str, password: str, client: ClientInfo
) -> TokenResponse:
    s = get_settings()
    username = username.strip().lower()
    fail_key = _login_fail_key(username)

    fails = int(await redis.get(fail_key) or 0)
    if fails >= s.login_max_failures:
        ttl = await redis.ttl(fail_key)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"登入失敗次數過多，請 {max(ttl, 60) // 60} 分鐘後再試")

    user = await db.scalar(select(User).where(User.username == username))
    ok = verify_password(password, user.password_hash if user and user.password_hash else DUMMY_PASSWORD_HASH)
    if not (user and user.password_hash and ok and user.is_active):
        pipe = redis.pipeline()
        pipe.incr(fail_key)
        pipe.expire(fail_key, s.login_lock_minutes * 60)
        await pipe.execute()
        _log(db, client, "password", False, user.id if user else None, username)
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "帳號或密碼錯誤")

    await redis.delete(fail_key)
    user.last_login_at = _now()
    _log(db, client, "password", True, user.id, username)
    await db.commit()
    await db.refresh(user)
    return await _issue_tokens(redis, user)


# ---------- 2b. Google 登入（未註冊就直接註冊） ----------
async def login_with_google(
    db: AsyncSession, redis: Redis, profile: GoogleProfile, client: ClientInfo, guest: User | None = None,
) -> TokenResponse:
    """已綁定的 Google 帳號直接登入；第一次用 Google 就自動建立帳號並登入（之後可在設定改名稱）。
    帶著訪客 token 時，新 Google 帳號會升級那個訪客，保留遊戲進度。"""
    linked = await db.scalar(select(OAuthAccount).where(
        OAuthAccount.provider == "google", OAuthAccount.provider_user_id == profile.sub))
    if linked:
        user = await db.get(User, linked.user_id)
        if not user or not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "帳號已停用")
        user.last_login_at = _now()
        _log(db, client, "google", True, user.id, user.username)
        await db.commit()
        await db.refresh(user)
        return await _issue_tokens(redis, user)

    if await db.scalar(select(User.id).where(User.email == profile.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "此 email 已被其他帳號使用")
    if guest is not None and guest.is_guest:
        user = guest
        user.is_guest = False
    else:
        user = User()
        db.add(user)
    user.username = await _free_username(db, profile)
    user.email = profile.email
    user.display_name = (profile.name or user.username)[:64]
    user.avatar_url = profile.picture
    user.last_login_at = _now()
    user.oauth_accounts.append(
        OAuthAccount(provider="google", provider_user_id=profile.sub, email=profile.email))
    try:
        await db.flush()
        _log(db, client, "register", True, user.id, user.username)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "建立帳號時發生衝突，請再試一次")
    await db.refresh(user)
    return await _issue_tokens(redis, user)


# ---------- 修改帳戶名稱 ----------
async def update_me(db: AsyncSession, user: User, body: UpdateMeRequest) -> User:
    if body.username is not None and body.username != user.username:
        if user.is_guest:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "訪客請先註冊帳號再修改使用者名稱")
        if await db.scalar(select(User.id).where(User.username == body.username)):
            raise HTTPException(status.HTTP_409_CONFLICT, "使用者名稱已被使用")
        user.username = body.username
    if body.display_name is not None:
        user.display_name = body.display_name
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "使用者名稱已被使用")
    await db.refresh(user)
    return user


# ---------- 3. 訪客登入 ----------
async def login_as_guest(db: AsyncSession, redis: Redis, client: ClientInfo) -> TokenResponse:
    s = get_settings()
    if client.ip:
        key = _guest_rate_key(client.ip)
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 3600)
        if count > s.guest_create_limit_per_hour:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "建立訪客帳號太頻繁，請稍後再試")

    for _ in range(5):  # 隨機名稱極少撞名，撞到就重試
        suffix = secrets.token_hex(4)
        user = User(username=f"guest_{suffix}", display_name=f"訪客{suffix[:4].upper()}",
                    is_guest=True, last_login_at=_now())
        db.add(user)
        try:
            await db.flush()
            break
        except IntegrityError:
            await db.rollback()
    else:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "無法建立訪客帳號，請重試")

    _log(db, client, "guest", True, user.id, user.username)
    await db.commit()
    await db.refresh(user)
    return await _issue_tokens(redis, user)


# ---------- Token 更新 / 登出 ----------
async def refresh_tokens(db: AsyncSession, redis: Redis, refresh_token: str) -> TokenResponse:
    user_id = await redis.getdel(_refresh_key(refresh_token))  # 用過即作廢（rotation）
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登入已過期，請重新登入")
    user = await db.get(User, uuid.UUID(user_id))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "帳號不存在或已停用")
    return await _issue_tokens(redis, user)


async def logout(redis: Redis, refresh_token: str) -> None:
    await redis.delete(_refresh_key(refresh_token))
