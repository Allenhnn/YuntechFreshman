from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# 固定讀 backend/.env，不管從哪個資料夾啟動伺服器
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # PostgreSQL
    postgres_user: str = "yuntech"
    postgres_password: str = "yuntech_dev_pw"
    postgres_db: str = "yuntech_freshman"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str | None = "yuntech_redis_pw"
    redis_db: int = 0
    cache_default_ttl: int = 300  # 秒

    # Auth
    jwt_secret_key: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    google_client_id: str = ""
    login_max_failures: int = 5  # 連續失敗幾次後鎖定
    login_lock_minutes: int = 15
    guest_create_limit_per_hour: int = 10  # 同一 IP 每小時可建立的訪客數

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def redis_url(self) -> str:
        auth = f":{self.redis_password}@" if self.redis_password else ""
        return f"redis://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
