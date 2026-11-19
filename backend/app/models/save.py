import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class GameSave(Base):
    """每個帳號一份遊戲進度（金錢、時間、背包、位置、最佳紀錄、重生點）。

    內容由前端定義（frontend/src/net/cloudSave.ts），後端只檢查大小、原樣存取；
    version 每次寫入 +1，可用來辨識哪一份比較新。
    """

    __tablename__ = "game_saves"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
