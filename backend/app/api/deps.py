import uuid

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.database import get_db
from app.models import User
from app.services.auth import ClientInfo

_bearer = HTTPBearer(auto_error=False)


async def get_optional_user(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    if not cred:
        return None
    payload = decode_access_token(cred.credentials)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token 無效或已過期")
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "帳號不存在或已停用")
    return user


async def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "請先登入")
    return user


def get_client_info(request: Request) -> ClientInfo:
    return ClientInfo(
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
