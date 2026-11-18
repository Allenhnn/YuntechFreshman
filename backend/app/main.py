from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from sqlalchemy import text

from app import models  # noqa: F401  確保資料表註冊到 Base
from app.api.auth import router as auth_router
from app.db.database import engine, init_db
from app.db.redis import redis_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await redis_client.ping()
    yield
    await redis_client.aclose()
    await engine.dispose()


app = FastAPI(title="雲寶寶上學趣 Backend", lifespan=lifespan)
app.include_router(auth_router)


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        db_ok = (await conn.execute(text("SELECT 1"))).scalar() == 1
    redis_ok = await redis_client.ping()
    return {"postgres": db_ok, "redis": redis_ok}


@app.get("/auth-test", include_in_schema=False)
async def auth_test_page():
    """開發用：帳號系統測試頁 → http://localhost:8000/auth-test"""
    return FileResponse(Path(__file__).parent / "static" / "auth_test.html")
