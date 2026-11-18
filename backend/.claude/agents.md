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
    ├── core/security.py   # 密碼雜湊（argon2）、JWT、refresh token
    ├── models/user.py     # User、OAuthAccount、LoginLog
    ├── schemas/auth.py    # 請求 / 回應格式與驗證規則
    ├── services/google.py # 驗證 Google ID token
    ├── services/auth.py   # 註冊 / 登入 / 訪客 / refresh 的商業邏輯與 DB、Redis 寫入
    ├── api/               # auth.py（路由）、deps.py（get_current_user 等）
    └── static/auth_test.html  # 開發用測試頁 → http://localhost:8000/auth-test
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

## 帳號系統

### 資料表（PostgreSQL）
**users** — 註冊玩家與訪客共用
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | 訪客升級後 id 不變（遊戲進度可直接掛在 user_id 上） |
| username | varchar(32) UNIQUE | 登入用，一律小寫；訪客為 `guest_xxxxxxxx` |
| email | varchar(255) UNIQUE NULL | 來自 Google；訪客為 NULL |
| password_hash | varchar(255) NULL | argon2id；訪客為 NULL（無法帳密登入） |
| display_name | varchar(64) | 遊戲內顯示名稱 |
| avatar_url | varchar(512) NULL | Google 頭像 |
| is_guest / is_active | bool | 訪客旗標 / 停權用 |
| created_at / updated_at / last_login_at | timestamptz | |

**oauth_accounts** — 第三方登入綁定，`UNIQUE(provider, provider_user_id)`
| 欄位 | 說明 |
|---|---|
| user_id | FK → users.id（ON DELETE CASCADE） |
| provider | `google` |
| provider_user_id | Google 的 `sub`（永久不變，比 email 可靠） |
| email | 綁定當下的 Google email |

**login_logs** — 每次登入 / 註冊（含失敗）一筆：user_id、method（register / password / google / guest）、success、username_attempted、ip_address、user_agent、created_at

### Redis keys
| Key | 值 | TTL | 用途 |
|---|---|---|---|
| `auth:refresh:<sha256(token)>` | user_id | 30 天 | refresh token；只存雜湊，用過即刪（rotation） |
| `auth:login_fail:<username>` | 失敗次數 | 15 分 | 連續錯 5 次鎖定 |
| `auth:guest_rate:<ip>` | 建立次數 | 1 小時 | 同 IP 每小時最多 10 個訪客 |

### API（`/docs` 可直接測試）
| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/auth/register/google` | `{id_token, username, password, display_name?}` → 201。帶訪客的 `Authorization: Bearer` 時，直接把該訪客升級成正式帳號 |
| POST | `/auth/login` | `{username, password}` → 200；錯誤一律回「帳號或密碼錯誤」 |
| POST | `/auth/login/google` | `{id_token}` → 200；未註冊回 404，前端改顯示註冊表單 |
| POST | `/auth/guest` | 建立訪客 → 201 |
| POST | `/auth/refresh` | `{refresh_token}` → 新的 access + refresh |
| POST | `/auth/logout` | `{refresh_token}` → 204 |
| GET | `/auth/me` | 目前使用者 |
| GET | `/auth/config` | 公開設定（`google_client_id`），給前端初始化 Google 按鈕 |
| GET | `/auth-test` | 開發用測試頁，三種登入與 token 操作都能點 |

所有登入類 API 都回傳 `{access_token, refresh_token, token_type, user}`。access token 是 JWT（30 分鐘），內含 `sub`（user id）與 `guest` 旗標。

### 前端串 Google 的方式
1. Google Cloud Console 建立「OAuth 2.0 用戶端 ID（網頁應用程式）」，已授權的 JavaScript 來源加上前端網址（如 `http://localhost:5173`）。
2. 把 Client ID 填到 backend 的 `.env` → `GOOGLE_CLIENT_ID`，前端也用同一個 ID。
3. 前端用 Google Identity Services（`https://accounts.google.com/gsi/client`）取得 `credential`，當作 `id_token` 送到後端。後端用 `google-auth` 驗證簽章、aud、exp。

## 開發約定
- ORM model 一律繼承 `app.db.database.Base`；路由用 `Depends(get_db)` 取得 session。
- 快取 key 命名：`<資源>:<id>`，例如 `player:42`、`leaderboard:weekly`。
- 目前用 `init_db()` 自動建表；model 穩定後改用 Alembic migration。
- 密碼只放 `.env`，不要寫進程式碼或 commit。

## 變更紀錄
### 2026-11-18（測試頁）
- 新增 `/auth-test` 測試頁與 `/auth/config`；Google Console 的「已授權的 JavaScript 來源」需加上 `http://localhost` 與 `http://localhost:8000`

### 2026-11-18（帳號系統）
- 新增資料表 users、oauth_accounts、login_logs，以及上方的 Redis keys
- 新增 API：Google 註冊、帳密登入、Google 一鍵登入、訪客登入、refresh、logout、/me
- 訪客可透過 Google 註冊升級，保留同一個 user id
- 安全機制：argon2id 密碼雜湊、連錯 5 次鎖 15 分鐘、refresh token rotation、訪客建立頻率限制
- `pyproject.toml` 加入 pwdlib[argon2]、pyjwt、google-auth、requests；`.env` 新增 JWT_SECRET_KEY（已產生隨機值）與 GOOGLE_CLIENT_ID（待填）
- 測試：用 SQLite + fakeredis 跑 24 個情境（含重複註冊、鎖定、升級、token 失效），全數通過

### 2026-11-18
- 新增 `docker-compose.yml`：PostgreSQL 17 + Redis 7（含 healthcheck、volume 持久化）
- 新增 `app/core/config.py`、`app/db/database.py`、`app/db/redis.py`
- `app/main.py` 改為 FastAPI app，啟動時連線 DB/Redis，新增 `GET /health`
- `pyproject.toml` 加入 sqlalchemy[asyncio]、asyncpg、redis、pydantic-settings
- 新增 `.env.example`、`.env`、`.gitignore`、`.claude/agents.md`

## 待辦
- [ ] 填入 `GOOGLE_CLIENT_ID`，用真的 Google 帳號測一次註冊
- [ ] 定期清除長期未登入的訪客帳號（例如 30 天未登入且 is_guest）
- [ ] 若部署在反向代理後面，client IP 要改讀 `X-Forwarded-For`
- [ ] 依需求文件 F01–F14 設計遊戲資料表（任務、成就、地點…），外鍵一律指向 users.id
- [ ] 導入 Alembic
