from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

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


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        db_ok = (await conn.execute(text("SELECT 1"))).scalar() == 1
    redis_ok = await redis_client.ping()
    return {"postgres": db_ok, "redis": redis_ok}
