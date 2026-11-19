# 雲寶寶上學趣 Backend

FastAPI + PostgreSQL + Redis 帳號服務（Google 註冊、帳密登入、訪客登入、refresh token）。

## 本機開發

```bash
cd backend
docker compose up -d            # PostgreSQL :5432、Redis :6379
uv run python -m app.main       # API → http://127.0.0.1:8000（文件 /docs、測試頁 /auth-test）
```

設定放在 `backend/.env`（不進版控），例如 `GOOGLE_CLIENT_ID=...`、`JWT_SECRET_KEY=...`、`POSTGRES_PORT=5433`。
沒設 `GOOGLE_CLIENT_ID` 時，前端只會顯示帳密登入和訪客登入。

## 和前端串接

前端（`frontend/`，`npm run dev`）把 `/api/*` 代理到 `http://127.0.0.1:8000`（`frontend/vite.config.ts`），
所以後端不需要 CORS。後端在別的位址時，用 `API_TARGET=http://host:port npm run dev`；正式建置可設 `VITE_API_BASE`。

登入流程（`frontend/src/net/authApi.ts`、`frontend/src/state/auth.ts`、`frontend/src/ui/login.tsx`）：

- 載入時讀 `GET /auth/config`，有存 refresh token 就呼叫 `GET /auth/me`（access token 過期會自動 `POST /auth/refresh`）。
- 登入分頁：帳密 `POST /auth/login`；同一列是 Google 按鈕（`POST /auth/login/google`，第一次使用自動註冊並登入）和訪客（`POST /auth/guest`）。
- 註冊分頁：使用者名稱 + 密碼 `POST /auth/register`，不需要 Google。
- 訪客在主選單按「註冊帳號」，會帶訪客 token 註冊，把同一個帳號升級並保留進度。
- 設定 → 顯示名稱 / 使用者名稱：`PATCH /auth/me`。
- 進度同步（`frontend/src/net/cloudSave.ts`）：登入時 `GET /save` 下載；之後每次本機存檔幾秒內 `PUT /save` 上傳，關頁時再送一次。
- 登出：`POST /auth/logout`。連不上伺服器時可選「離線遊玩」，下次登入時再同步。
