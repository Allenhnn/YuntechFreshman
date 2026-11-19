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
- 登入：`POST /auth/login`；Google：`POST /auth/login/google`，回 404 表示還沒註冊 → 顯示設定帳密表單 → `POST /auth/register/google`。
- 訪客：`POST /auth/guest`；主選單的「綁定帳號」會帶訪客 token 呼叫註冊，把同一個帳號升級。
- 登出：`POST /auth/logout`。連不上伺服器時可選「離線遊玩」。
