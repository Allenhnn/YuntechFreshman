# 匯入所有 model，讓 Base.metadata 能建立全部資料表
from app.models.save import GameSave
from app.models.user import LoginLog, OAuthAccount, User

__all__ = ["User", "OAuthAccount", "LoginLog", "GameSave"]
