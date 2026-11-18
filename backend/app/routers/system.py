"""系統路由：健康檢查、開發用頁面。"""
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse
from sqlalchemy import text

from app.db.database import engine
from app.db.redis import redis_client

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"

router = APIRouter(tags=["system"])


@router.get("/health")
async def health():
    async with engine.connect() as conn:
        db_ok = (await conn.execute(text("SELECT 1"))).scalar() == 1
    redis_ok = await redis_client.ping()
    return {"postgres": db_ok, "redis": redis_ok}


@router.get("/auth-test", include_in_schema=False)
async def auth_test_page():
    """開發用：帳號系統測試頁 → http://localhost:8000/auth-test"""
    return FileResponse(STATIC_DIR / "auth_test.html")
