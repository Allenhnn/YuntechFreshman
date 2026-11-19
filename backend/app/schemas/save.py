from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SaveIn(BaseModel):
    data: dict[str, Any] = Field(description="前端的存檔內容（JSON 物件）")


class SaveOut(BaseModel):
    data: dict[str, Any]
    version: int
    updated_at: datetime
