import json
from typing import Any

from redis.asyncio import Redis

from app.core.config import get_settings

_settings = get_settings()
redis_client: Redis = Redis.from_url(_settings.redis_url, decode_responses=True)


async def get_redis() -> Redis:
    """FastAPI dependency。"""
    return redis_client


async def cache_get(key: str) -> Any | None:
    raw = await redis_client.get(key)
    return json.loads(raw) if raw is not None else None


async def cache_set(key: str, value: Any, ttl: int | None = None) -> None:
    await redis_client.set(key, json.dumps(value, ensure_ascii=False), ex=ttl or _settings.cache_default_ttl)


async def cache_delete(key: str) -> None:
    await redis_client.delete(key)
