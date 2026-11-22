# agents.md — 雲寶寶上學趣 Backend 開發紀錄

> 給 AI agent（Claude 等）與組員看的專案脈絡與變更紀錄。
> **規則：每完成一個新需求，都要同步更新本檔**，不用等人提醒：
> 1. 在「變更紀錄」最上方新增一筆（日期、做了什麼、為什麼）
> 2. 更新受影響的段落：目錄結構、資料表、Redis keys、API、環境變數、疑難排解
> 3. 完成的待辦打勾，新發現的待辦加進去

## 專案概要
- 專案：《雲寶寶上學趣》— 雲林科技大學 3D 第三人稱校園導覽網頁遊戲（軟體工程課，組別「良田」）
- 本資料夾：後端 API（`YuntechFreshman/backend`）
- Git：repo 根目錄是 `YuntechFreshman`，後端在 `back-end` 分支；commit message 格式 `feat:簡短說明`

## 技術棧
| 項目 | 選擇 |
|---|---|
| 語言 / 套件管理 | Python 3.11 / uv |
| Web 框架 | FastAPI |
| 資料庫 | PostgreSQL 17（Docker）＋ SQLAlchemy 2.0 async ＋ asyncpg |
| 快取 | Redis 7（Docker，AOF 持久化）＋ redis-py asyncio |
| 設定 | pydantic-settings，固定讀取 `backend/.env`（與啟動時所在資料夾無關） |
| 認證 | Google Identity Services ＋ google-auth、JWT（PyJWT）、argon2id（pwdlib） |

## 目錄結構
```
backend/
├── .claude/agents.md          # 本檔：開發紀錄
├── docker-compose.yml         # postgres + redis
├── .env / .env.example        # 環境變數（皆被 .gitignore 忽略）
├── pyproject.toml / uv.lock
└── app/
    ├── main.py                # 入口：app = create_app()，`python -m app.main` 用 uvicorn 啟動
    ├── factory.py             # create_app()：lifespan、掛載路由
    ├── core/
    │   ├── config.py          # Settings（伺服器 / DB / Redis / Auth 設定）
    │   └── security.py        # 密碼雜湊（argon2）、JWT、refresh token
    ├── db/
    │   ├── database.py        # engine、SessionLocal、Base、get_db、init_db
    │   └── redis.py           # redis_client、get_redis、cache_get/set/delete
    ├── models/user.py         # User、OAuthAccount、LoginLog
    ├── models/save.py         # GameSave（每個帳號一份遊戲進度）
    ├── schemas/auth.py        # 請求 / 回應格式與驗證規則
    ├── schemas/save.py        # 存檔的請求 / 回應格式
    ├── services/
    │   ├── google.py          # 驗證 Google ID token
    │   └── auth.py            # 註冊 / 登入 / 訪客 / refresh 的商業邏輯與 DB、Redis 寫入
    ├── routers/
    │   └── system.py          # 系統路由：/health、/auth-test
    ├── api/
    │   ├── auth.py            # /auth/* 路由
    │   ├── save.py            # /save 路由（雲端存檔）
    │   └── deps.py            # get_current_user、get_optional_user、get_client_info
    └── static/auth_test.html  # 開發用測試頁 → http://localhost:8000/auth-test
```

## 常用指令
```bash
docker compose up -d            # 啟動 PostgreSQL + Redis
docker compose ps               # 查看健康狀態
uv sync                         # 安裝相依套件
uv run python -m app.main       # 開發伺服器（uvicorn，在 backend/ 執行）
uv run app/main.py              # 同上，直接執行檔案也可以
uv run fastapi dev app/main.py  # FastAPI CLI 也仍可使用
                                # → /health、/docs、/auth-test
docker compose exec postgres psql -U yuntech -d yuntech_freshman
docker compose exec redis redis-cli -a yuntech_redis_pw
docker compose down             # 停止（加 -v 會連資料一起刪除）
```

## 伺服器設定（`.env`）
| 變數 | 預設 | 說明 |
|---|---|---|
| `APP_HOST` | `127.0.0.1` | 要讓同網路的手機/組員連線時改 `0.0.0.0` |
| `APP_PORT` | `8000` | |
| `APP_RELOAD` | `true` | 改 `.py` 自動重啟；正式環境設 `false` |

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

**game_saves** — 每個帳號一份遊戲進度
| 欄位 | 說明 |
|---|---|
| user_id | PK、FK → users.id（ON DELETE CASCADE）；訪客升級後 id 不變，存檔自動跟著 |
| data | JSON，內容由前端定義（`frontend/src/net/cloudSave.ts`）：`{v, savedAt, progress, raceBest, customSpawn}`；上限 64 KB |
| version | 每次寫入 +1 |
| updated_at | timestamptz |

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
| POST | `/auth/register` | `{username, password, display_name?}` → 201。不用 Google 直接註冊；帶訪客的 `Authorization: Bearer` 時把該訪客升級 |
| POST | `/auth/register/google` | `{id_token, username, password, display_name?}` → 201（舊流程，前端已不用，保留給測試頁） |
| POST | `/auth/login` | `{username, password}` → 200；錯誤一律回「帳號或密碼錯誤」 |
| POST | `/auth/login/google` | `{id_token}` → 200；**第一次使用的 Google 帳號會自動註冊並登入**（使用者名稱取 email @ 前段，撞名加數字；沒有密碼）。帶訪客 token 時把訪客升級 |
| PATCH | `/auth/me` | `{display_name?, username?}` → 修改帳戶名稱；訪客只能改顯示名稱，重名回 409 |
| GET | `/save` | 目前帳號的存檔 `{data, version, updated_at}`；沒有回 404 |
| PUT | `/save` | `{data}` 覆寫存檔 |
| DELETE | `/save` | 刪除存檔 → 204 |
| POST | `/auth/guest` | 建立訪客 → 201 |
| POST | `/auth/refresh` | `{refresh_token}` → 新的 access + refresh |
| POST | `/auth/logout` | `{refresh_token}` → 204 |
| GET | `/auth/me` | 目前使用者 |
| GET | `/auth/config` | 公開設定（`google_client_id`），給前端初始化 Google 按鈕 |
| GET | `/auth-test` | 開發用測試頁，三種登入與 token 操作都能點 |

所有登入類 API 都回傳 `{access_token, refresh_token, token_type, user}`。access token 是 JWT（30 分鐘），內含 `sub`（user id）與 `guest` 旗標。

### 前端串 Google 的方式
1. Google Cloud Console 建立「OAuth 2.0 用戶端 ID（網頁應用程式）」。已授權的 JavaScript 來源要加上：
   - `http://localhost` 與 `http://localhost:8000`（後端測試頁）
   - 前端開發網址（如 `http://localhost:5173`）
   - 用 `127.0.0.1` 開頁面時，`http://127.0.0.1:8000` 要另外加
   - 改完要等幾分鐘才生效；OAuth 在「測試中」時，只有測試使用者名單裡的帳號能登入
2. 把 Client ID 填到 backend 的 `.env` → `GOOGLE_CLIENT_ID`（已填），前端可呼叫 `GET /auth/config` 取得同一個 ID。Client ID 可公開，不需要 Client Secret。
3. 前端用 Google Identity Services（`https://accounts.google.com/gsi/client`）取得 `credential`，當作 `id_token` 送到後端。後端用 `google-auth` 驗證簽章、aud、exp。

## 開發約定
- 新增路由模組：建立 router 檔案（系統類放 `app/routers/`，業務 API 目前在 `app/api/`），然後到 `app/factory.py` 的 `_include_routers()` 加一行 `include_router`。
- ORM model 一律繼承 `app.db.database.Base`；路由用 `Depends(get_db)` 取得 session。
- 快取 key 命名：`<資源>:<id>`，例如 `player:42`、`leaderboard:weekly`。
- 目前用 `init_db()` 自動建表；model 穩定後改用 Alembic migration。
- 密碼只放 `.env`，不要寫進程式碼或 commit。

## 疑難排解
| 症狀 | 原因 / 解法 |
|---|---|
| `fastapi dev` 啟動就報 `ConnectionRefusedError`、`5432` 或 `6379` | PostgreSQL / Redis 沒開 → 開 Docker Desktop，`docker compose up -d` |
| 改了 `.env` 沒效果 | `fastapi dev` 只在 `.py` 變動時重新載入 → 手動重啟伺服器 |
| 測試頁顯示「讀不到 GOOGLE_CLIENT_ID」 | `.env` 沒填或沒重啟；`/auth/config` 可確認後端實際讀到的值 |
| Google 按鈕跳 `origin_mismatch` | 目前網址來源沒加進 Google Console 已授權的 JavaScript 來源 |
| `.env.example` 沒被 commit | 根目錄 `.gitignore` 有 `.env*`；需要時用 `git add -f backend/.env.example` |

## 變更紀錄
### 2026-11-23（前端：學生宿舍C 北棟室內移除、東翼破圖修正）— 分支 `fix/dorm-c-front-gate`
- 需求：把 C 棟的室內建模先刪除；修正截圖中 C 棟東翼的破圖
- `frontend/src/campus/campusFixes.ts`：`splitDormC` 產生的三塊（中段、西翼、東翼）都設 `sealed`——沒有生成的室內、門畫成關著
- 決定：只封北棟（使用者一直稱為 C 棟的這棟）；故事的寢室（起床、睡覺、衣櫃）在南邊那棟 C（296668592），保留它的室內，否則 Day 1 起床會壞
- `frontend/src/buildings/dormCFacade.ts`：破圖原因是東翼南端牆花磚旁的柱子在平的素牆前凸出 0.5 m；`blank` 實心牆段改成與外框同深（含牆基與碰撞）
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機從使用者截圖視角看過、確認北棟沒有室內（已移除）

### 2026-11-23（前端：學生宿舍C 東翼依使用者手繪平面調整立面）— 分支 `fix/dorm-c-front-gate`
- 需求：使用者畫了東翼平面（房間、曬衣間、浴室、戶廳），紅色斜線為實心牆無窗，window 處為戶廳
- `frontend/src/buildings/dormCFacade.ts`：新增牆格 `blank`（只有外皮）與版型 `eastEast`；東翼南端牆＝轉角曬衣間大花磚＋其餘實心；東牆＝南角浴室實心＋三間房窗；戶廳高窗改在凹口的西向牆，凹口北面與南向短牆改實心
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機看過中庭側、東側與凹口（已移除）

### 2026-11-23（前端：學生宿舍C 東翼回到原本格局）— 分支 `fix/dorm-c-front-gate`
- 需求：使用者給地圖截圖，東翼格局要長那樣（原寬、內側有凹口）
- `frontend/src/campus/campusFixes.ts`：`splitDormC` 取消東半鏡像，東翼回到 OSM 外形（分界點 S 在北面）；西側的房間外移保留
- `frontend/src/campus/customFacades.ts`：`DORM_C_PIECES`、分界牆、手工立面邊號回到對應的編號；陽台在中段 edge 4、從 OSM vertex 13 量起
- `frontend/src/buildings/dormCFacade.ts`：凸出段右側不再有房間列；東側凹口北面＝一間戶廳（3 層）、凹口另兩面加樓層帶；東翼南端牆變長，素牆段依長度放數扇小窗
- 決定：凸出段只有西側一間房（東側凹口只有約 4.2 m，放不下房間＋戶廳）
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機空拍看過（已移除）

### 2026-11-23（前端：學生宿舍C 東翼依轉角照重建、西翼內側牆改素牆）— 分支 `fix/dorm-c-front-gate`
- 需求：使用者截圖藍框（東翼）依實拍轉角照重建、紅框（中段）不動；另一張截圖斜線處（西翼面向中庭的內側牆）改成一般牆面、什麼都不放
- `frontend/src/buildings/dormCFacade.ts`：兩翼六面牆改用版型 `Layout`（`clothLeft`、`eastSouth`、`eastWest`、`side`、`plain`）；東翼長內側面＝窗戶＋冷氣、靠轉角深框白柱開口＋窄花磚；東翼南端牆＝轉角一大格花磚（`screen`）＋每層一扇小窗（`single`）；西翼內側牆 `plain`；移除先前按比例壓縮的東翼端牆
- 追加（使用者：側面三個太多）：東翼長內側面改成只有一間房＋一間曬衣間，兩格各佔一半（新牆格 `room`）
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機從使用者兩張截圖的視角看過（已移除）

### 2026-11-23（前端：學生宿舍C 北棟右半比照左半）— 分支 `fix/dorm-c-front-gate`
- 需求：使用者截圖分紅（左半，已完成）藍（右半）兩邊，右半要跟左半一樣
- `frontend/src/campus/campusFixes.ts`：`splitDormC` 改寫——凸出段西端照舊外移一間房寬，東半整個用陽台中線鏡像西半（房間、轉角、戶廳、分界）；東翼內側牆往東退到鏡像戶廳的端點（平行原內側牆，接到南端牆）
- `frontend/src/campus/customFacades.ts`：`DORM_C_PIECES` 改成命名點；`DORM_C_BALCONY_SPAN`；陽台改在中段 edge 5、從頂點 i 量起多一間房寬；分界牆、手工立面邊號更新
- `frontend/src/buildings/dormCFacade.ts`：凸出段兩側各一列房間、兩側戶廳都是一間高窗；東翼端牆較短時四格（戶廳、兩間房、曬衣間）按比例縮小、不掛冷氣；陽台端柱改用 `DORM_C_BALCONY_SPAN[0]`（修正端柱被算成 4.4 m 的錯誤）
- 決定：OSM 的東翼比西翼偏內，鏡像後東翼變窄（約 8.3 m 寬）；中庭東側多出的空地維持草地
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機正面與東翼看過（已移除）

### 2026-11-23（前端：學生宿舍C 北棟依使用者標註調整房間配置）— 分支 `fix/dorm-c-front-gate`
- 需求：依遊戲截圖標註，凸出段每層是一間房間＋曬衣間；退縮處是戶廳；兩翼端牆每層只有一間曬衣間、兩間房間，另一端是戶廳
- `frontend/src/campus/customFacades.ts`：`DORM_C.roomWidth = 3.4`
- `frontend/src/campus/campusFixes.ts`：`splitDormC` 把中段西轉角（原 vertex 14、15）沿正面往西移一間房寬
- `frontend/src/buildings/dormCFacade.ts`：凸出段左邊加房間列；兩翼端牆改成「外側曬衣間花磚＋兩間房＋內側戶廳大窗」（西翼曬衣間在左、東翼在右）
- 追加：凸出段西側的退縮處（藍框）只有一間戶廳：整面一格、每層一扇高窗、不掛冷氣
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機從使用者截圖視角與兩翼正面看過（已移除）

### 2026-11-23（前端：學生宿舍C 北棟改成中段 4 層、兩翼 3 層，依照片重建兩翼與洗衣陽台正面）— 分支 `fix/dorm-c-front-gate`
- 需求：使用者說中段 4 層、左右兩邊 3 層，依下方三張照片重建；中間曬衣間依上方兩張正面照再重建
- `frontend/src/campus/campusFixes.ts`：`splitDormC` 把 OSM 296668596（原 5 層 18 m）載入時切成中段（原 id，4 層）與西翼 2966685961、東翼 2966685962（3 層）；`remapSplitTraced` 在描圖室內開啟時把殼體門洞搬到新分塊
- `frontend/src/campus/customFacades.ts`：`DORM_C`、`DORM_C_PIECES`、`PARTY_WALLS`、`STYLE_ALIAS`；洗衣陽台改 2F–4F、整個凸出段寬（兩端各留 1 m 柱）、只挖外牆厚度 0.4 m
- `frontend/src/campus/chunkBuilder.ts`：分界牆（只在描圖室內時拆）、分塊沿用原本的立面樣式與色調
- `frontend/src/campus/entrances.ts`：備援入口跳過 `CUSTOM_FACADE_EDGES` 的牆，門不會被手工立面蓋住
- 新增 `frontend/src/interiors/clipToShells.ts`（interiorWorker 用）：描圖室內超出較矮殼體的樓層剪掉、電梯落點移到最近走廊
- `frontend/src/main.ts`：呼叫上面兩個 fix；在描圖索引中列出（即使沒有門）的建築不再補備援自動門
- `frontend/src/buildings/dormCFacade.ts` 重寫：中段一整片格柵＋兩端開口（白水管、橫桿）、外框深 1.5 m、一樓整面玻璃門廳；兩翼六面牆（灰色牆基、深框花磚格柵列、窗戶遮陽板、冷氣）
- 決定：目前 `FLOORPLAN_INTERIORS` 關閉，三塊各自有生成的室內與入口，分界牆保留；中段 4F 以上、兩翼 3F 以上都沒有室內
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 用暫時的除錯相機從中庭、空中與陽台內檢查（除錯碼已移除）

### 2026-11-22（前端：學生宿舍C 北棟中段洗衣陽台室內）— 分支 `fix/dorm-c-front-gate`
- 需求：依使用者四張陽台室內照，重新建模建築中間的陽台
- 發現：立面上的紅色是赤陶鏤空圓環花磚，不是磁磚；後面是長條洗衣陽台
- `frontend/src/campus/customFacades.ts`：新增 `DORM_C_BALCONY`、`CUSTOM_FACADE_OPENINGS`（OSM 296668596 edge 13，2F–5F 每層開洞）
- `frontend/src/campus/chunkBuilder.ts`：`WindowCut.open`，開洞只做牆厚收邊、不放玻璃與窗框
- `frontend/src/buildings/dormCFacade.ts`：格柵改成 alpha 鏤空貼圖（`latticePanel`）、前緣改薄矮牆；新增 `laundryRoom`（地磚、白磁磚洗手台、木門、隔牆、洗衣機、鐵窗花窗、曬衣桿、日光燈、曬衣架）；一樓雨遮梁降低避免穿出 2F 地板
- 決定：陽台往室內深 1.3 m（描圖平面在約 1.5 m 後就是寢室），只能從外面看、走不進去；兩扇門是裝飾
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 用暫時的除錯相機進陽台內對照四張照片（除錯碼已移除）

### 2026-11-22（前端：學生宿舍C 前門格柵與推開式鐵門、C 北棟中段南面重建）— 分支 `fix/dorm-c-front-gate`
- 需求：依使用者遊戲截圖（紅框）在門樓兩側短牆補紅色格柵、鐵門改成像木門一樣推開；依實拍與小地圖紅色箭頭重建從 C 中庭往北看到的立面（被樹擋住的部分與另一半對稱）
- `frontend/src/campus/dormYard.ts`：格柵依牆長能放幾片就放幾片（牆墩最窄 0.3 m），門樓兩側各兩片；`portal` 門改成兩扇以門框為軸往中庭內開的門（`SWING`，`SensorGate.swing`），其他宿舍門仍是橫拉
- 新增 `frontend/src/buildings/dormCFacade.ts`：OSM 296668596（學生宿舍C 北棟，U 形）中段面向中庭的 edge 11–15；洗石子外框、窗列、紅磚凹陽台、雨遮梁與「C」、玻璃門廳、台階平台、花台盆栽、地磚紅磚帶；有碰撞
- 新增 `frontend/src/campus/customFacades.ts`，`chunkBuilder.ts` 在列出的牆略過程序立面細節（遮陽板會穿出外皮）
- 決定：箭頭指向的是 296668596（小地圖 +z 朝南），不是 296668592；中段門廳的門是裝飾，遊戲可進入的門依描圖資料仍在北面
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 實際走到門口與中庭看過

### 2026-11-22（前端：學生宿舍C 前門依近照重建門樓與圍牆）— 分支 `fix/dorm-c-front-gate`
- 需求：依使用者的大門近照再重新建模
- `frontend/src/campus/dormYard.ts`（只影響 `portal` 門＝學生宿舍C 前門）：
  - 門樓改成一整塊米白色量體（新增 `PORTAL`：寬 3.9、高 3.15、深 0.8 m，門洞 2.7 × 2.25 m），頂上灰色壓頂
  - 門洞兩側牆面各一盞黃銅半球燈（兩面都有），門洞上方右側灰色燈箱、門邊小讀卡機，門下石材門檻
  - 圍牆：米白色、灰色牆基與厚壓頂；從門樓往外「0.8 m 紅褐菱格花磚格柵（後面暗色帶青綠）→ 0.95 m 實牆墩」交替，格柵幾乎整片牆高
  - 感應門：改成淡藍色門框，左半鐵板、右半直條，寬度跟門洞一致；放在牆厚中央，滑行距離每扇門各自計算（`SensorGate.travel`）
  - 步道往外延伸穿過大門（t −7–30），這座門不再鋪共用的門口磚
- 測試：`tsc --noEmit`、`vite build` 通過；headless Chrome 在步道上朝門口看確認

### 2026-11-22（前端：學生宿舍C 前門依實拍修細節）— 分支 `fix/dorm-c-front-gate`（從 feat/login af24168 開出）
- 需求：依使用者照片（紅色箭頭為視角，從 C 中庭往東看前門）修 C 棟門口細節
- 先比對現況：門口由 `campus/dormYard.ts` 的 `DORM_GATES` 產生，全部宿舍門共用紅瓦門樓＋鐵色感應門；中庭全是草地
- `frontend/src/campus/dormYard.ts`：
  - `GateMark.portal`：只有「學生宿舍C 前門」用，其他門不變
    - 門樓：紅瓦屋頂改成白色深門楣，柱頂兩側各一盞圓球燈（兩面都有）
    - 圍牆：每跨嵌紅色花磚格柵，感應門改淡藍色
  - 新增 `C_FRONT`，在中庭側鋪設：
    - 從前門往西 6.9–30 m、寬 4 m 的灰色連鎖磚步道，每 3 m 一道紅色雙排磚帶，UV 沿步道方向
    - 步道南側到 C 東翼（296668595）一片深紅褐色磚鋪廣場
    - 東翼靠門的兩面牆前做入口平台（0.45 m），自由的三邊各三階，玻璃雙門＋玻璃店面（直框）
    - 步道北側草地上一支黑色方頭路燈、一叢灌木
  - `dormYardClearings` 加入步道與廣場範圍，避免撒樹
- 測試：`tsc --noEmit`、`vite build` 通過；headless Chrome 從照片同一位置朝東看確認（截圖時把故事關掉，避免一開始躺在宿舍床上）
- 備註：`fix/dorm-d-entry-terrace`（D 入口平台補到牆面）尚未合併進 feat/login

### 2026-11-20（前端：迴旋坡道往 D 側平移、與走廊欄杆相接、中間鏤空）— 分支 `feat/dorm-c-d-exterior`
- 需求：把迴旋坡道平移到截圖紅線位置；坡道跟旁邊的圍欄（D 側走廊花磚欄杆）連在一起，中間連接處直接鏤空
- `frontend/src/buildings/dormCourtyard.ts`：`RAMP` 全部往 D 側移 0.8 m，外牆外緣在 w −8.6（紅線）
  - 東側台階起點跟著隔牆移，變寬 0.8 m；石桌跟著坡道中線
  - 坡道與 D 側欄杆之間原本填實到地面的一塊拿掉，鏤空直通中庭地坪／D 騎樓
  - 路尾端加一段同樣花磚的短欄杆，把坡道外牆和走廊欄杆接起來
- 測試：`tsc --noEmit`、`vite build` 通過；headless Chrome 從路尾同一視角確認

### 2026-11-20（前端：迴旋坡道下方開洞、D 側柱廊改成與 C 側相同的騎樓）— 分支 `feat/dorm-c-d-exterior`
- 需求：依 Street View 照片在迴旋坡道下方開一個洞；坡道另一側（D 側）也照 C 側騎樓照片的做法
- `frontend/src/buildings/dormCourtyard.ts`：
  - 新增 `TUNNEL`（s ≈ FLOOR_S0+0.1 – +1.7，第一根柱子旁）：上層坡道、外牆、隔牆在這段改成只有 0.25 m 的板，下方淨高約 2 m；`sloped()` 加上可選的底面函式
  - 洞口從中庭穿過坡道，通到 D 側騎樓
  - 騎樓改用 `for side of [1, -1]` 兩側共用：地面開洞擴到 |w| ≤ `ARCADE_BACK`（12.9），兩側走廊都改由樓板承托
  - 鐵捲門 C 在西端、D 在東端；冷氣與紅色水管放在另一端；移除舊的 D 側平面門片柱廊
- 測試：`tsc --noEmit`、`vite build` 通過；headless Chrome 從中庭朝 D 側看，確認坡道下洞口可看穿到 D 騎樓

### 2026-11-20（前端：C、D 下沉中庭——花台對齊、石桌移到坡道前、C 側騎樓依實拍重做）— 分支 `feat/dorm-c-d-exterior`
- 需求：坡道那側的花台（樹）跟對面一排水平對齊；石桌放到迴旋坡道前方；依 Street View 照片修正坡道對面（C 側）的建模
- `frontend/src/buildings/dormCourtyard.ts`：
  - 南排花台改到與北排相同的 s（FLOOR_S0 + 3 / 8.5 / 14），左右成對
  - 石桌＋石頭移到坡道半圓平台正前方（坡道中線上）
  - C 側改成有深度的騎樓：地面開洞延伸到 `ARCADE_BACK`（w 12.9），走廊改由 0.35 m 樓板（含碰撞）承托，原本的北側擋牆拿掉
  - 騎樓內容：池邊 6 根方柱＋深梁；後牆是玻璃店面（直框）配木門，最西一跨白色鐵捲門，東端冷氣與紅色水管
  - 兩端台階段在樓板下填實
- 測試：`tsc --noEmit`、`vite build` 通過；headless Chrome 從中庭朝北、朝東兩個視角確認

### 2026-11-20（前端：C、D 下沉中庭的迴旋無障礙坡道與東側台階修正）— 分支 `feat/dorm-c-d-exterior`
- 需求（使用者手繪）：紅框為迴旋無障礙坡道，長度加到第一根柱子旁；石桌放在斜前方；藍線處為台階；只改坡道與台階
- `frontend/src/buildings/dormCourtyard.ts`：新增 `RAMP`——D 側一座 U 形迴旋坡道
  - 外道從路尾地面往西下到 s 21.5 的半圓平台（弧形矮牆就是平台外緣）
  - 內道折返往東，下到第一根柱子旁（s ≈ 10）的中庭地坪；內側牆在東端留 1.5 m 開口
  - 坡度約 1:10；坡道與牆用斜頂實體＋convexHull 碰撞
  - 東側台階改為從坡道隔牆一路到 C 側牆，取消原本置中的 8 m 台階與兩側擋牆、東端矮牆
  - 原本的弧形矮牆併入坡道平台；石桌與石頭移到平台斜前方
- 測試：`tsc --noEmit`、`vite build` 通過；headless Chrome 從路尾往西、中庭往東看確認

### 2026-11-20（前端：學生宿舍C、D 之間的下沉中庭）— 分支 `feat/dorm-c-d-exterior`
- 需求：依兩個視角的 Street View 照片（以紅色箭頭為方向：從宿舍服務路路尾往西、從中庭往東）重新建模 C 棟（296668592）與 D 棟（296668593）之間
- 新增 `frontend/src/buildings/dormCourtyard.ts`（沿用 `mgmtCourtyard.ts` 的下沉庭園做法）：沿兩棟牆面的局部座標（s 往西、w 往北），地坪下沉 3 m（s 3.5–35、w −10–9.9）
  - 路尾紅磚鋪面＋三支混凝土車阻；正中 8 m 寬、20 階往西下的台階，兩側擋牆
  - 中庭深灰方磚、兩排米色磚砌花台（草＋小棕櫚叢）錯開排列；東南角弧形混凝土矮牆；D 側石頭與石桌
  - 南北各留 3 m 地面層走廊（C、D 的門都在這面牆上，維持 y = 0 可進入），走廊邊紅色鏤空花磚欄杆；欄杆下是中庭層柱廊：C 側白色鐵捲門、D 側深色門洞
  - 西端整面 20 階寬台階往上回到草地
- `main.ts`：`dormCourtPit()` 的洞加入 `groundHoles`、地面碰撞體在洞內忽略（兩處 filter）、`treeFree` 加入 keepClear；`createDormCourtyard` 建立與 dispose
- `mgmtCourtyard.ts`：匯出 `Soup`、`canvasTex`、`speckle` 供共用
- 測試：`tsc --noEmit` 通過、`vite build` 成功；headless Chrome 從路尾往西、中庭往東、中庭往西三個視角確認與照片對應，角色在洞內正確落到中庭地坪

### 2026-11-20（前端：學生宿舍D 入口改成與服務中心相同的雨遮＋台階＋坡道）— 分支 `feat/dorm-c-d-exterior`
- 需求：D 棟上方屋簷與下方階梯、無障礙坡道的範圍與角度都跟宿舍服務中心一樣
- `frontend/src/buildings/dormFeatures.ts`：重構為「角落座標系」——每處入口只描述兩面牆（`C_CORNER`：北棟南面＋南翼東面；`D_CORNER`：北翼東面＋東翼北面），原點為兩牆延長線交點；共用尺寸 `ENTRY`（前緣 x + z = 8.76、短段 1 m、台階東段 x = 10.65、坡道頂 z = 10.8、內緣短段 0.81 m）與 `RAMP`；共用 `addEntryGround`（平台、三階台階、坡道與矮牆）、`addEntryPlaza`（鋪面、樹穴、花盆、燈柱）；C 的服務中心量體不變（數值換算後與上一版相同），D 改為同輪廓的雨遮（頂板、前緣 D 字混凝土帶、短段混凝土帶、三根方柱）、兩樘門、綠籬花台、告示牌；移除舊 D 門廊 / 平台 / 台階 / 北翼花台
- 測試：`tsc --noEmit` 通過、`vite build` 成功；用實際校園資料檢查 D 的台階、坡道、樹穴、花盆、燈柱不壓道路與建築（坡道低端離路緣約 3 m）；headless Chrome 截圖確認 C 不變、D 正確
- 注意：檔案同步工具曾把舊版 dormFeatures.ts 寫回本機一次，已用新檔名重寫並以 md5 確認

### 2026-11-20（前端：宿舍服務中心依使用者平面圖重新生成）— 分支 `feat/dorm-c-d-exterior`
- 需求：依手繪平面圖重新生成（藍＝服務中心、紅＝台階）；使用者外出，由我自行判斷、不用開網頁
- 判讀：圖的方向同使用者先前的俯視截圖（上方橫線＝南翼、右側直線＝北棟、黑色斜線＝OSM 小斜牆）；以北棟長度定比例後，紅線寬正好 1.05 m（三階），外緣東端剛好到北棟東南角
- `frontend/src/buildings/dormFeatures.ts`：服務中心改為 45° 正面（x + z = 5.3）＋兩端 1 m 短牆垂直接牆；前方 0.6 m 平台；三階台階沿平台外緣（西段 z = 10.8 接坡道外側矮牆、45° 段 x + z = 9.19、東段 x = 7.19 接北棟南面）；坡道從平台西南角沿南翼下降 4 m（沿南翼那段紅線視為無障礙坡道，與上一輪約定一致）；廣場花盆、樹穴、燈柱改放在台階外；新增模組層級 `prism()`、`wingLine()`、`svcFront()`、`stepsLine()`
- 新增未 commit 的 `start-dev.command`（專案根目錄）：雙擊啟動 docker、後端、前端並打開網頁
- 測試：`tsc --noEmit` 通過、`vite build` 成功；用實際校園資料檢查不壓道路與建築；headless Chrome 截圖確認

### 2026-11-20（前端：宿舍服務中心本體移回「往前幅度減半」的位置）— 分支 `feat/dorm-c-d-exterior`
- 需求：宿舍服務中心整體位置不該動，只移坡道與台階；本體移回去（使用者選「往前幅度減半」：店面牆比最初往前約 0.4 m）
- `frontend/src/buildings/dormFeatures.ts`：店面牆回到 x + z = 6.725（先前誤把它退到前廊後面的 4.46）；取消內凹前廊，招牌與白色簷口改回從牆面往外出挑 1 m；台階直接從店面牆腳開始，第一階為 0.6 m 門檻平台（共四階）；坡道、台階、花盆、燈柱、樹穴在世界座標中的位置不變（正面座標換算 x + 1.8、z − 1.6）
- 測試：`tsc --noEmit` 通過、`vite build` 成功；headless Chrome 截圖確認（未提供給使用者）

### 2026-11-19（前端：宿舍服務中心坡道與台階依使用者標線調整）— 分支 `feat/dorm-c-d-exterior`
- 需求：依截圖上的紅線調整無障礙坡道與台階位置；結果直接以網頁開啟（不要截圖）
- `frontend/src/buildings/dormFeatures.ts`：坡道改為從前廊外緣西端（南翼牆角）沿南翼牆面往外下降（長 4 m、寬 1.4 m、離牆 0.1 m，斜面為自訂 BufferGeometry＋凸包碰撞），外側矮牆、扶手、藍色指標牌跟著坡道；台階改為沿整個正面（從坡道外側矮牆到北棟牆面），西端貼著坡道矮牆斜下、東端沿北棟牆面；移除原本與立面平行的坡道、三角平台與斜牆；燈柱移到坡道低端
- 呈現：重新打包發佈到 claude.ai 網頁（artifact「雲寶寶上學趣」）
- 測試：`tsc --noEmit` 通過、`vite build` 成功；坡道低端離路緣約 1.0 m

### 2026-11-19（前端：宿舍服務中心只讓台階突出、往前幅度減半）— 分支 `feat/dorm-c-d-exterior`
- 需求：宿舍服務中心只要台階部分突出，整體往前移動的幅度縮減一半
- `frontend/src/buildings/dormFeatures.ts`：前廊改為內凹（在建築輪廓內），店面牆退到前廊後面（`WALL_K = outerK − 前廊深 × √2`），前廊上方以牆色楣樑、白色簷底、屋頂延伸到外緣、牆到牆；招牌移到前廊外緣；只有台階（與旁邊的坡道）突出到廣場。前廊外緣 `CORNER.outerK` = 6.725（上一版往前的 0.8 m 減半）；店面、招牌、台階、坡道、花盆、燈柱、樹穴位置配合新正面調整
- 測試：`tsc --noEmit` 通過、`vite build` 成功；用實際校園資料檢查不壓道路與建築；headless Chrome 在使用者截圖位置 (32.3, 337.7) 截圖確認

### 2026-11-19（前端：宿舍服務中心與學生宿舍D 入口範圍擴大）— 分支 `feat/dorm-c-d-exterior`
- 需求：D 棟入口與宿舍服務中心的範圍再擴大一點，並以網頁呈現結果
- `frontend/src/buildings/dormFeatures.ts`：服務中心正面往外移約 0.8 m（`CORNER.frontK` 6.15 → 7.3，正面長 14.4 → 16.1 m、量體加深），店面、招牌、台階、坡道、花盆、燈柱、樹穴同步右移；D 棟門廊加深到 3.6 m（寬約 12.4 m）、台階加寬、廣場往外延伸，樹穴、花盆、燈柱往外移，北翼牆外花台改到 6.2–8.2 m
- 呈現：打包後發佈為 claude.ai 網頁（artifact「雲寶寶上學趣」，mascot.glb 內嵌，因發佈服務不收 .glb）
- 測試：`tsc --noEmit` 通過、`vite build` 成功；用實際校園資料檢查不壓道路與建築（最近離路緣 0.6 m）；headless Chrome 截圖確認

### 2026-11-19（前端：學生宿舍D 入口依正面照重修）— 分支 `feat/dorm-c-d-exterior`
- 需求：使用者提供 D 棟入口正面照，要求修正 D 棟前面
- `frontend/src/buildings/dormFeatures.ts`：原本的小雨遮改為整個凹角的門廊（左右切到兩面翼牆，約 11 m 寬）：頂板、前緣混凝土帶（藍色 D）、三根方柱；斜牆與北翼東面各一樘深色玻璃門（裝飾），中間綠籬花台；全寬平台與四階台階、左端藍色雙管扶手、白色告示牌；前方廣場鋪面、三個方形樹穴（樹縮窄拉高，樹冠在二樓以上）、紅色花盆、兩側黑色雙燈頭燈柱；北翼牆外的花台移到門廊外
- 重構：`addTreePits()`、`addPaving()` 抽成共用（C、D 兩處都用），樹穴可指定 `lift`（垂直拉高）
- 測試：`tsc --noEmit` 通過、`vite build` 成功；用實際校園資料檢查不壓道路與建築；headless Chrome 從廣場東北側對著入口截圖，與正面照比對
- 待確認：D 棟遊戲中可進入的門（描圖資料）仍在東面，凹角的兩樘門目前是裝飾

### 2026-11-19（前端：宿舍服務中心正面改為斜向）— 分支 `feat/dorm-c-d-exterior`
- 需求：使用者指出正面照中服務中心是斜的
- `frontend/src/buildings/dormFeatures.ts`：正面改為斜切學生宿舍C L 形內角的 45° 立面（x + z = 6.15，從南翼牆面切到北棟南面，全長 14.4 m），朝東南面向路口；量體是被正面切下的那塊轉角（ExtrudeGeometry＋凸包碰撞）；招牌、店面、前廊、台階、坡道、花盆、燈柱、樹穴改在「正面座標系」配置；廣場鋪面延伸到南北向路邊（離路緣約 0.4 m）
- 重構：`frameAt()`（任意原點與方向的局部座標系），`wallFrame()` 改用它；`serviceFrontFrame()` 由 C 棟牆面座標系推出正面座標系
- 測試：`tsc --noEmit` 通過、`vite build` 成功；用實際校園資料檢查各部件不壓道路與建築；headless Chrome 從廣場東南側對著正面截圖

### 2026-11-19（前端：宿舍服務中心依正面照重新建模）— 分支 `feat/dorm-c-d-exterior`
- 需求：使用者提供宿舍服務中心正面照，要求仔細觀察後重新建模
- `frontend/src/buildings/dormFeatures.ts`：服務中心量體改為填滿學生宿舍C L 形轉角（ExtrudeGeometry 沿北棟、斜牆、南翼）；正面三段（♿ 實牆段、玻璃店面含下排「宿舍服…務中心」字貼、深色窗段）、深灰招牌（藍色 C、金字校名、LED 板）與白色簷口；全寬前廊與台階；坡道改為與立面平行、往東上升，外側混凝土矮牆與藍色指標牌；新增廣場鋪面（灰色連鎖磚夾紅磚帶）與兩個方形樹穴（種校園樹）
- `frontend/src/campus/campusWorld.ts`：匯出 `campusTreeGeometry()`（原本內部的樹幹 / 樹冠幾何），讓其他模組種出一樣的樹
- `frontend/src/main.ts`：`createDormFeatures` 多傳 `env.materials`（樹的材質）
- 文件：`frontend/docs/streetscape-remodel.md` 該列更新
- 測試：`tsc --noEmit` 通過、`vite build` 成功；headless Chrome 在廣場上對著店面截圖，與正面照比對

### 2026-11-19（前端：學生宿舍C 宿舍服務中心、學生宿舍D 入口小物件）— 分支 `feat/dorm-c-d-exterior`
- 需求：依使用者在遊戲截圖標記的兩處與實拍照片，在學生宿舍C 外加「宿舍服務中心」、學生宿舍D 外加入口周邊小物件（先前誤做成腳踏車，已撤回、未保留）
- 新增 `frontend/src/buildings/dormFeatures.ts`（比照 `mgmtFeatures.ts` / `yuntayExterior.ts` 的結構）：C 棟 L 形轉角內的單層玻璃店面（招牌帶、前廊、台階、坡道與扶手、花盆、雙燈頭燈柱）；D 棟東北向入口凹處的雨遮、門、平台與台階、藍色扶手、花台綠籬、燈柱、花盆；全部含碰撞
- `frontend/src/main.ts`：建立 / 釋放 `createDormFeatures`，`dormTreeFree()` 加入 `keepClear`（樹不會長在設施上）
- 文件：`frontend/docs/streetscape-remodel.md`「使用者實拍對照」新增一列
- 測試：`tsc --noEmit` 通過、`vite build` 成功；headless Chrome 在截圖位置與 C、D 前方實際截圖確認
- 待確認：遊戲中 D 棟真正可進入的門（描圖資料）在東面，入口裝飾依照片放在斜牆凹處

### 2026-11-19（帳密註冊、Google 自動註冊、改名、雲端存檔）
- 新增 `POST /auth/register`：沒有或不想用 Google 帳號時，直接用使用者名稱 + 密碼註冊（可升級訪客）
- `POST /auth/login/google` 改為第一次使用就自動註冊並登入（不再回 404 要求另填帳密）；自動產生使用者名稱，之後可在設定修改
- 新增 `PATCH /auth/me`：修改顯示名稱 / 使用者名稱
- 新增資料表 `game_saves` 與 `GET/PUT/DELETE /save`：登入後遊戲進度存到帳號，前端在自動存檔、暫停、離開、最佳紀錄、重生點變動時上傳，登入時下載
- `UserOut` 新增 `has_password`、`has_google`
- Google 公鑰抓取失敗時重試一次，仍失敗回 503（原本是未處理的 500）
- 修正：Google 自動註冊時先查可用的使用者名稱再建立 User（查詢會 autoflush 半成品 User，造成 username NOT NULL 錯誤）
- 測試：curl 測帳密註冊 / 重名 / guest_ 開頭 / 格式錯誤、改名（含重名、訪客限制）、存檔讀寫刪、訪客升級後存檔保留；前端實測註冊、進度上傳、清空本機後重新登入取回進度、換帳號不繼承進度、設定改名

### 2026-11-18（routers 資料夾）
- 新增 `app/routers/system.py`：`/health`、`/auth-test` 從 `factory.py` 搬到這裡，`factory.py` 只負責 lifespan 與掛載路由
- 測試：路由完整、`/auth-test` 200、uvicorn 可正常啟動、帳號系統測試全數通過

### 2026-11-18（App factory 與 uvicorn 啟動）
- 新增 `app/factory.py`：`create_app()` 負責建立 FastAPI、lifespan、掛載路由；`/health`、`/auth-test` 移到 `system_router`
- `app/main.py` 改為 `app = create_app()`，並可用 `python -m app.main` / `app/main.py` 直接以 uvicorn 啟動（`app_dir` 固定為 backend，從任何資料夾執行都可以）
- `config.py` 新增 `APP_HOST`、`APP_PORT`、`APP_RELOAD`，`.env` / `.env.example` 同步新增
- `pyproject.toml` 明確加入 `uvicorn[standard]`
- 測試：兩種啟動方式皆成功啟動 uvicorn；所有路由仍正確掛載；帳號系統測試全數通過

### 2026-11-18（測試頁）— `0277bde`
- 新增 `/auth-test` 測試頁與 `GET /auth/config`
- 修正：`config.py` 原本用相對路徑找 `.env`，不在 `backend/` 啟動就讀不到（`GOOGLE_CLIENT_ID` 變空字串）→ 改為固定讀 `backend/.env`
- 測試頁 Google 區塊加上錯誤提示與 OAuth 來源設定檢查清單
- 已填入 `GOOGLE_CLIENT_ID`，Google 按鈕可正常顯示

### 2026-11-18（帳號系統）— `1219725`
- 新增資料表 users、oauth_accounts、login_logs，以及上方的 Redis keys
- 新增 API：Google 註冊、帳密登入、Google 一鍵登入、訪客登入、refresh、logout、/me
- 訪客可透過 Google 註冊升級，保留同一個 user id
- 安全機制：argon2id 密碼雜湊、連錯 5 次鎖 15 分鐘、refresh token rotation、訪客建立頻率限制
- `pyproject.toml` 加入 pwdlib[argon2]、pyjwt、google-auth、requests；`.env` 新增 JWT_SECRET_KEY（已產生隨機值）與 GOOGLE_CLIENT_ID
- 測試：用 SQLite + fakeredis 跑 24 個情境（含重複註冊、鎖定、升級、token 失效），全數通過

### 2026-11-18（資料庫與快取）— `2c3c20e`
- 新增 `docker-compose.yml`：PostgreSQL 17 + Redis 7（含 healthcheck、volume 持久化）
- 新增 `app/core/config.py`、`app/db/database.py`、`app/db/redis.py`
- `app/main.py` 改為 FastAPI app，啟動時連線 DB/Redis，新增 `GET /health`
- `pyproject.toml` 加入 sqlalchemy[asyncio]、asyncpg、redis、pydantic-settings
- 新增 `.env.example`、`.env`、`.gitignore`、`.claude/agents.md`

## 待辦
- [x] 填入 `GOOGLE_CLIENT_ID`
- [x] 用真的 Google 帳號在 `/auth-test` 測一次完整註冊 → 帳密登入 → 訪客升級
- [ ] 定期清除長期未登入的訪客帳號（例如 30 天未登入且 is_guest）
- [ ] 若部署在反向代理後面，client IP 要改讀 `X-Forwarded-For`
- [ ] 依需求文件 F01–F14 設計遊戲資料表（任務、成就、地點…），外鍵一律指向 users.id
- [ ] 導入 Alembic
- [ ] Google 自動註冊的帳號目前沒有密碼，之後可在設定加「設定密碼」讓它也能帳密登入
- [ ] 相簿照片（前端 IndexedDB）尚未上傳到帳號
