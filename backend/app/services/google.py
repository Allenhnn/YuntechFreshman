from dataclasses import dataclass

from fastapi import HTTPException, status
import requests
from google.auth.exceptions import TransportError
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


# 共用連線（keep-alive），不必每次驗證都重新握手
_google_request = google_requests.Request(session=requests.Session())


async def verify_google_id_token(token: str) -> GoogleProfile:
    """驗證前端送來的 Google ID token（簽章、aud、exp、iss 都會檢查）。"""
    client_id = get_settings().google_client_id
    if not client_id:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "伺服器未設定 GOOGLE_CLIENT_ID")
    info = None
    for attempt in range(2):  # Google 的公鑰要連網抓；偶爾連線被中斷，重試一次
        try:
            info = await run_in_threadpool(
                google_id_token.verify_oauth2_token, token, _google_request, client_id
            )
            break
        except ValueError:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google 驗證失敗，請重新登入 Google")
        except TransportError:
            if attempt == 1:
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "暫時連不上 Google 驗證伺服器，請再試一次")
    if not info.get("email_verified"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "此 Google 帳號的 email 尚未驗證")
    return GoogleProfile(
        sub=info["sub"], email=info["email"].lower(), name=info.get("name"), picture=info.get("picture")
    )
