import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

_password_hasher = PasswordHash.recommended()  # argon2id


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _password_hasher.verify(password, password_hash)


# 帳號不存在時也跑一次驗證，避免用回應時間判斷帳號是否存在
DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing")


def create_access_token(user_id: uuid.UUID, is_guest: bool) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "access",
        "guest": is_guest,
        "iat": now,
        "exp": now + timedelta(minutes=s.access_token_expire_minutes),
    }
    return jwt.encode(payload, s.jwt_secret_key, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict | None:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret_key, algorithms=[s.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    return payload if payload.get("type") == "access" else None


def new_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Redis 只存 refresh token 的 SHA-256，不存明文。"""
    return hashlib.sha256(token.encode()).hexdigest()
