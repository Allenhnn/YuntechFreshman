from dataclasses import dataclass

from fastapi import HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings


@dataclass
class GoogleProfile:
    sub: str
    email: str
    name: str | None
    picture: str | None


async def verify_google_id_token(token: str) -> GoogleProfile:
    """驗證前端送來的 Google ID token（簽章、aud、exp、iss 都會檢查）。"""
    client_id = get_settings().google_client_id
    if not client_id:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "伺服器未設定 GOOGLE_CLIENT_ID")
    try:
        info = await run_in_threadpool(
            google_id_token.verify_oauth2_token, token, google_requests.Request(), client_id
        )
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google 驗證失敗，請重新登入 Google")
    if not info.get("email_verified"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "此 Google 帳號的 email 尚未驗證")
    return GoogleProfile(
        sub=info["sub"], email=info["email"].lower(), name=info.get("name"), picture=info.get("picture")
    )
