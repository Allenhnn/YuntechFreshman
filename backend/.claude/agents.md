# agents.md — 雲寶寶上學趣 Backend 開發紀錄

> 給 AI agent（Claude 等）與組員看的專案脈絡與變更紀錄。
> 每次有結構性變更（新增服務、改架構、改環境變數），請在「變更紀錄」最上方新增一筆。

## 專案概要
- 專案：《雲寶寶上學趣》— 雲林科技大學 3D 第三人稱校園導覽網頁遊戲（軟體工程課，組別「良田」）
- 本資料夾：後端 API（`YuntechFreshman/backend`）

## 技術棧
| 項目 | 選擇 |
|---|---|
| 語言 / 套件管理 | Python 3.11 / uv |
| Web 框架 | FastAPI |
| 資料庫 | PostgreSQL 17（Docker）＋ SQLAlchemy 2.0 async ＋ asyncpg |
| 快取 | Redis 7（Docker，AOF 持久化）＋ redis-py asyncio |
| 設定 | pydantic-settings，讀取 `.env` |

## 目錄結構
```
backend/
├── .claude/agents.md      # 本檔：開發紀錄
├── docker-compose.yml     # postgres + redis
├── .env / .env.example    # 環境變數（.env 不進 git）
├── pyproject.toml
└── app/
    ├── main.py            # FastAPI 入口、lifespan、/health
    ├── core/config.py     # Settings（DB / Redis 連線字串）
    └── db/
        ├── database.py    # engine、SessionLocal、Base、get_db、init_db
        └── redis.py       # redis_client、get_redis、cache_get/set/delete
```

## 常用指令
```bash
docker compose up -d            # 啟動 PostgreSQL + Redis
docker compose ps               # 查看健康狀態
uv sync                         # 安裝相依套件
uv run fastapi dev app/main.py  # 開發伺服器 → http://localhost:8000/health
docker compose exec postgres psql -U yuntech -d yuntech_freshman
docker compose exec redis redis-cli -a yuntech_redis_pw
docker compose down             # 停止（加 -v 會連資料一起刪除）
```

## 連線資訊（開發環境預設值）
- PostgreSQL：`postgresql+asyncpg://yuntech:yuntech_dev_pw@localhost:5432/yuntech_freshman`
- Redis：`redis://:yuntech_redis_pw@localhost:6379/0`，預設 TTL 300 秒

## 開發約定
- ORM model 一律繼承 `app.db.database.Base`；路由用 `Depends(get_db)` 取得 session。
- 快取 key 命名：`<資源>:<id>`，例如 `player:42`、`leaderboard:weekly`。
- 目前用 `init_db()` 自動建表；model 穩定後改用 Alembic migration。
- 密碼只放 `.env`，不要寫進程式碼或 commit。

## 變更紀錄
### 2026-11-18
- 新增 `docker-compose.yml`：PostgreSQL 17 + Redis 7（含 healthcheck、volume 持久化）
- 新增 `app/core/config.py`、`app/db/database.py`、`app/db/redis.py`
- `app/main.py` 改為 FastAPI app，啟動時連線 DB/Redis，新增 `GET /health`
- `pyproject.toml` 加入 sqlalchemy[asyncio]、asyncpg、redis、pydantic-settings
- 新增 `.env.example`、`.env`、`.gitignore`、`.claude/agents.md`

## 待辦
- [ ] 依需求文件 F01–F14 設計資料表（玩家、任務、成就、地點…）
- [ ] 導入 Alembic
