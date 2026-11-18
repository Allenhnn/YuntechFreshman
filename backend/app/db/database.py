from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    """所有 ORM model 繼承這個 Base。"""


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency：每個 request 一個 session。"""
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    """開發用：依 model 建表（正式環境建議改用 Alembic migration）。"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
