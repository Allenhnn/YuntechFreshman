"""建立 FastAPI 應用：設定 lifespan、掛載所有路由。

新增路由模組時，在 _include_routers() 裡 include_router 即可。
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import models  # noqa: F401  確保資料表註冊到 Base
from app.api.auth import router as auth_router
from app.api.save import router as save_router
from app.db.database import engine, init_db
from app.db.redis import redis_client
from app.routers.system import router as system_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 啟動：建表、確認 Redis 連得上
    await init_db()
    await redis_client.ping()
    yield
    # 關閉：釋放連線
    await redis_client.aclose()
    await engine.dispose()


def _include_routers(app: FastAPI) -> None:
    app.include_router(system_router)
    app.include_router(auth_router)
    app.include_router(save_router)


def create_app() -> FastAPI:
    app = FastAPI(title="雲寶寶上學趣 Backend", lifespan=lifespan)
    _include_routers(app)
    return app
