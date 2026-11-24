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
### 2026-11-24（前端：學生宿舍C 戶廳窗改單純一片玻璃、移到凹口開口正中）— 分支 `feat/dorm-c-yard-walls`
- 需求：戶廳窗戶造型怪怪的；單純窗戶就好，不要紗窗、不要看起來能開的
- 原因：2 樓交誼廳窗在東側凹口牆的正中，東半邊正對東翼的牆，從室內看出去左邊一大塊是洗石子牆
- `customFacades.ts` `DORM_C_HALL_2F` a0/a1 改 2.53–4.93（往西 1.1 m）；`dormCUnit.ts` `DORM_C_LIVING_WINDOW` 改 [17.5, 19.9]；`dormCFacade.ts` 東側戶廳各層窗改照 `DORM_C_HALL_2F` 置中（上下層對齊），`windowAt` 加 `plain`：2 樓這扇只有外框；`dormCUnitDecor.ts` 室內窗框拿掉直櫺與橫檔
### 2026-11-24（前端：學生宿舍C C2–C3 後門圍牆照平面圖移位）— 分支 `feat/dorm-c-yard-walls`
- 需求：依 C 區平面圖調整宿舍圍牆，特別是平面圖右側 C2 與 C3 相連的那道牆
- 平面圖與遊戲方向相差 180°（圖右＝遊戲西）。前門牆（C1–C3）與南側 C1–C2 封牆原本就對；後門牆原本從兩棟中間（x≈-33）穿過，改沿外側邊線
- `frontend/src/campus/dormYard.ts`：`學生宿舍C 後門` 的 `ends` 改成 C3 西翼西南角外 (-44.47, 323.98) → C2 西北角 (-41.0, 347.1)，門在中間；新增 `WALL_STUBS` 補 C3 西翼牆角到圍牆起點的短牆；`CLOSED_GAPS` 迴圈改為先收集 `plainWalls` 再一起產生
- C3 西翼與中段的分界原本從北面頂點 2 斜拉到南面頂點 16，中段比西翼高一層，4 樓西牆看起來斜斜的（使用者：平面圖中沒有斜斜的）。`campusFixes.ts` `splitDormC` 新增點 `B`（西翼內側牆面 16→17 的延長線與北面 1→2 的交點），`customFacades.ts` `DORM_C_PIECES`：中段 `[…, 16, 'B']`、西翼 `[16, 17, 18, 19, 0, 1, 'B']`——分界變成直的；邊號不變（中段多一條 B→2 的北面短牆，在最後）
### 2026-11-24（前端：學生宿舍C 寢室上下床改在樓梯旁）— 分支 `fix/dorm-c-front-gate`
- 需求：上床下床改為靠近樓梯
- `frontend/src/buildings/dormCUnit.ts` `dormCRoomBeds`：每張上鋪多一個 `ladder`——該側樓梯櫃前走道上的梯腳（靠窗那張在樓梯靠窗側、靠門那張在靠門側）
- `frontend/src/main.ts`：`dormBedLadder`；寢室上鋪的「躺上床」提示改在梯腳 0.9 m 內出現（不再看床的位置），下床（E 或移動鍵）站回梯腳
- 測試：`tsc --noEmit`、`vite build` 通過；新遊戲在寢室 4 床上醒來，下床站在東側樓梯腳；走回梯腳出現「E 躺上床」，按 E 躺回去（暫時除錯碼已移除）

### 2026-11-24（前端：遊戲出生點改在學生宿舍C 寢室 4）— 分支 `fix/dorm-c-front-gate`
- 需求（附截圖）：最右邊那間寢室（寢室 4）設為遊戲出生點
- `frontend/src/main.ts`：`startPoint()`——寢室 4 門內 1.7 m、面向窗（地底寢室那棟）；新遊戲、「回到起點」、沒設自訂重生點時的重生都用它（沒有寢室資料時退回 C 棟中庭）；`teleport` 先對所有手工建築呼叫 `update`，讓目的地的室內（寢室在 90 m 外會卸載）先載入再落地；開場也先載入出生點附近的室內
- 再修（使用者：開新遊戲還是從原本的地方開始）：新遊戲的劇情一開始會把人放到「學生宿舍C」的床上，原本只找得到南棟（舊故事寢室）的生成家具床，而且偏好下鋪——`dormCUnit.ts` 新增 `dormCRoomBeds`／`DORM_C_LOFT_TOP`（四間寢室各四張上鋪的位置與床頭方向），`main.ts` 把它們做成床位（`dormBeds`）：靠近時可按 E 躺上去，`putInBed` 先找 15 m 內的寢室床，所以新遊戲直接在寢室 4 的床上醒來
- 測試：`tsc --noEmit`、`vite build` 通過；從 200 m 外用「回到起點」傳回寢室 4，站在地板上（y −20）、面向窗；清除進度開新遊戲，躺在寢室 4 靠門那座上鋪（y −17.94）

### 2026-11-24（前端：學生宿舍C 交誼廳窗戶看得到外面）— 分支 `fix/dorm-c-front-gate`
- 需求：戶廳（交誼廳）的窗戶要看得到外面
- `frontend/src/campus/customFacades.ts`：`DORM_C_HALL_2F`——中段東側退縮戶廳那面（edge 3）2 樓窗的位置把外殼牆挖開
- `frontend/src/buildings/dormCFacade.ts`：東側戶廳 2 樓那扇窗的外皮挖洞、玻璃改透明（`windowAt` 多一個玻璃材質參數）；其他樓層照舊暗玻璃
- `frontend/src/buildings/dormCUnit.ts`：`DORM_C_LIVING_WINDOW` x 18.6–21.0，交誼廳前牆在那段開口
- `frontend/src/buildings/dormCUnitDecor.ts`：交誼廳原本兩排貼圖窗拿掉，改成真的窗：開口上下補牆與碰撞、室內側深色窗框（四格直框＋一道橫框，看起來像照片的上下兩排）
- 測試：`tsc --noEmit`、`vite build` 通過；從交誼廳看得到中庭與對面大樓，從外面看得到交誼廳裡面（暫時除錯碼已移除）

### 2026-11-24（前端：學生宿舍C 交誼廳照照片重新布置）— 分支 `fix/dorm-c-front-gate`
- 需求（附交誼廳照片）：移除戶廳所有家具，改成照片的樣子
- `frontend/src/buildings/dormCUnitDecor.ts` 交誼廳：拿掉電視、茶几、布沙發、餐桌凳子、公告欄、鞋櫃、飲水機；改成照片——窗牆上下兩排深框窗、一套厚實松木沙發（三人座背靠窗、西側兩人座、東側單人座，扶手粗木塊、背板有直條）圍著木座玻璃面茶几，窗角一張邊桌放電話、旁邊白色暖氣機，天花吊扇＋日光燈，東牆一張牛皮紙、開關面板；地板改米色磨石子
- 也在這一輪（尚未 commit 的前幾項）：曬衣間天花縫加梁、兩端牆角補牆、鏡頭擋在天花下、2 樓花磚旁衣架拿掉、門改靠端牆開、洗手台整段加深、牆面材質統一
- 測試：`tsc --noEmit`、`vite build` 通過；從兩個角度看過交誼廳（暫時除錯碼已移除）；沒有實際走路測試

### 2026-11-23（前端：學生宿舍C 曬衣間天花／牆破圖、拿掉窗邊衣架）— 分支 `fix/dorm-c-front-gate`
- 需求（附截圖）：曬衣間靠陽台那邊破圖
- 原因：曬衣間天花（3.0 m）與陽台天花（3.35 m）在陽台後牆線（y 13.4–13.58）之間有一條縫，中段大樓是空殼，從縫看上去是天空
- `frontend/src/buildings/dormCUnitDecor.ts`：沿那條線加一根橫梁（從曬衣間天花到 3.52 m、y 13.25–13.64），把縫封起來（照片上那裡本來就有梁）
- 再修（使用者：左右兩邊的牆壁也破掉了）：第三人稱鏡頭會升到曬衣間／陽台天花上方，天花只有朝下的一面，從上面看房間像沒有屋頂、牆頂露出來——加實心擋板把鏡頭擋在兩個天花下面（曬衣間天花上 0.65 m、陽台天花處），曬衣間天花上再蓋一層不透明的板；陽台的天花本身就是實心板
- 再修（使用者：這裡還是破圖，另一邊也是）：曬衣間兩側牆與陽台兩端牆在舊後牆線（y 13.4–13.58）沒接上，留一條直縫看到外面——兩端各補一段實心牆（全高、含碰撞）
- 再調整（使用者：門換到另一邊開、洗手台延伸到兩邊並加深、牆壁材質一樣，另一邊也是）：後牆兩扇門都開著、靠端牆那側為鉸鏈（西門後面是深色門洞），門往內移讓出洗手台；兩端洗手台從後牆一路到前面矮牆、深 0.8 m、五個水龍頭；兩端牆整段同樣材質（1.3 m 以下白磁磚、以上白粉刷，陽台段到陽台天花），後牆也貼白粉刷（避開通工作室的門與窗）；工作室門移到 x 9.8–11.2 讓開東端洗手台
- 再調整（使用者：窗戶旁邊的衣架也移除）：`dormCFacade.ts` `laundryRoom` 2 樓不畫花磚旁的不鏽鋼曬衣架（3、4 樓照舊）
- 測試：`tsc --noEmit`、`vite build` 通過；從截圖的角度看過，看不到天空；從天花上方看是實心板；3 樓陽台地板沒有被蓋到（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 曬衣間寬度對齊陽台窗、拿掉中間曬衣架）— 分支 `fix/dorm-c-front-gate`
- 需求：曬衣間的範圍跟窗戶（陽台花磚開口）一樣，不要延伸；拿掉曬衣間中間的衣架
- `frontend/src/buildings/dormCUnit.ts`：`cloth` 改成 [4.24, 9.6, 12.24, 13.4]，內牆面剛好在陽台兩端牆（x 4.34–12.14），深度不變；分兩塊矩形避免消防栓
- `frontend/src/buildings/dormCUnitDecor.ts`：拿掉室內中間兩座不鏽鋼曬衣架；西下窗改放在工作室窗西邊；天花鋼架與燈照新寬度排（陽台前面的曬衣架照舊）
- 測試：`tsc --noEmit`、`vite build` 通過；從陽台往後牆看過（暫時除錯碼已移除）；沒有實際走路測試

### 2026-11-23（前端：學生宿舍C 曬衣間照照片布置，維持上一版比例）— 分支 `fix/dorm-c-front-gate`
- 需求（附 4 張曬衣間照片）：曬衣間的架構長這樣，重新建模；中途試過縮回陽台寬，使用者要維持上一版的比例、不要調整範圍
- 範圍維持上一版：曬衣間 [0.2, 9.6, 12.2, 13.4]（12 × 3.8 m＋陽台）、工作室 [7.8, 6.5, 12.2, 9.6]＋北段、工作室窗 x 8.0–9.2、曬衣間↔工作室門 `clothDoor` x 9.95–11.35
- `frontend/src/buildings/dormCFacade.ts` `laundryRoom`：2 樓不畫水槽、隔間、洗衣機、天花曬衣桿（後牆、門、窗原本就不畫），改由室內裝飾畫
- `frontend/src/buildings/dormCUnitDecor.ts`：曬衣間照照片布置——兩端牆白磁磚＋整條磁磚洗手台四個水龍頭（東端一路接到陽台端牆）；後牆兩端棕色門（東門開著通工作室、西門關著）＋深色門框、門內側白色矮隔間、各兩台洗衣機（靠隔間那台墊高）、下窗（東＝工作室的透明窗、西對稱暗玻璃）與上排暗窗；深藍曬衣鋼架、兩座不鏽鋼曬衣架
- 測試：`tsc --noEmit`、`vite build` 通過；看過後牆與側面（暫時除錯碼已移除）；沒有實際走路測試

### 2026-11-23（前端：學生宿舍C 2 樓照平面圖放大、交誼廳對齊紅框）— 分支 `fix/dorm-c-front-gate`
- 需求：寢室已經拿掉了（改傳送），把戶廳照平面圖放大；不要自己延伸戶廳——紅框（退縮的戶廳那一格）就是戶廳的範圍，對齊、不要伸到旁邊
- `frontend/src/buildings/dormCUnit.ts`：橫向讓交誼廳剛好填滿退縮戶廳那一格（x = 16.55 + 0.02875·(px − 397)，寢室 1 因此落在陽台右邊那扇窗後面），縱向每像素 0.045 m、交誼廳前緣在戶廳窗（y = 11.2 − 0.045·(522 − py)）；只蓋走廊（3.65 × 2.9 m）、雜物間（比草圖寬，往西到陽台門）、交誼廳（5.75 × 10.1 m，從戶廳窗一路到後牆）；寢室 1–4 與浴室的門／黑幕照草圖的 1/4 圓；大門在交誼廳東牆
- `frontend/src/buildings/dormCUnitDecor.ts`：交誼廳照新大小重排（電視、茶几、沙發、北側餐桌四凳、北牆公告欄、鞋櫃、飲水機、大窗、四盞燈）
- 再調整（附截圖與工作室照片）：交誼廳西牆縮到紅線（只留 y 6.5–11.2，走廊往南加深到 6.5，跟交誼廳的開口變寬）；雜物間（工作室）的門改到走廊南牆西端（紅框，x 13.0–13.9），雜物間改成 [10.3, 6.5, 14.2, 13.45]；裡面照照片：門口深色門框、淺木門開著靠在牆邊、上方深色百葉、門旁灰色電箱；室內深色地磚、白牆、西牆整排白磁磚檯面＋三個水龍頭＋磁磚擋水牆、南牆一扇深框窗、通往陽台的門洞也加深色框與百葉；雜物間分成兩個長度 < 6 m 的矩形，避免生成器在裡面掛消防栓
- 再調整（使用者：整個戶廳範圍太寬，縮小一點，包含走廊）：交誼廳與走廊的北牆一起從後牆（y 1.1）拉到 y 3.6——交誼廳 5.75 × 7.6 m、走廊 3.65 × 2.9 m；寢室 2–4 的門、浴室黑幕跟著北牆移；餐桌往南移、燈重排；交誼廳與走廊的開口只在兩者重疊的那段
- 再調整（附 cloth／work／bath 草圖，藍線是門；使用者：廁所的黑幕太小，連曬衣間的位置重新建模）：工作室改成 L 形——陽台正後方一大塊（南牆門洞通陽台），西側再往北一塊（放鐵架）；走廊往西延伸 1.2 m 成為草圖上的小通道，通道南側是工作室的門、北側是浴室黑幕（黑幕加大到 1.05 × 2.45 m）；浴室在它們後面（仍是傳送）；電箱移到通道旁；工作室的窗移到陽台門西邊
- 再調整（使用者：曬衣間還是只有陽台那樣，工作間也不是平面圖的比例）：照 cloth／work／bath 草圖的比例重做（草圖轉 180°：上＝正面、左＝東；橫向約 0.0125 m／像素、縱向 0.0141）——曬衣間是整片寬的室內洗曬間 [0.2, 9.6, 12.2, 13.4]（12 × 3.8 m），南牆沿陽台整段打開，`dormCFacade.ts` 2 樓陽台不畫後牆、木門、後牆窗，陽台就是曬衣間的前段；曬衣間裡洗衣機一排、西牆磁磚洗手檯三水龍頭、深藍曬衣鋼架、兩座不鏽鋼曬衣架、白磁磚腰牆；工作室 L 形 [7.8, 6.5, 12.2, 9.6]＋[7.8, 3.6, 10.8, 6.5]，往曬衣間的門洞（寬 1.4 m，深色框＋百葉）在東段、旁邊一扇鐵窗；走廊西端通道 x 10.8–12.2；曬衣間分三塊矩形避免消防栓
- 再調整（附工作室室內照片：黃色的是插座，左邊的窗看得到曬衣間）：工作室西牆的檯面改成照片——白磁磚平台（下面空的）、三排磁磚擋水牆、三個米色插座（拿掉水龍頭），一路接到窗那面牆；窗改成真的看得穿：工作室與曬衣間之間的牆在 x 8.0–9.2 開口（`DORM_C_WORK_WINDOW`，`open`），裝飾補上窗台下、窗上的牆與碰撞，深色框兩片透明玻璃；曬衣間那側的腰牆磁磚在窗下讓開
- 再調整（使用者：檯面延伸到牆壁、移除儲物架、檯面深一點）：工作室檯面沿整面西牆從北端牆一路到窗那面牆，深 0.8 m；拿掉北段的鐵架、紙箱、水桶拖把
- 中途試過讓交誼廳穿過共用牆進東翼（挖開中段 edge 2／東翼 edge 8 的 2 樓），使用者不要，已還原
- 測試：`tsc --noEmit`、`vite build` 通過；外面看退縮戶廳沒有東西穿出來；走廊西端看得到雜物間門與浴室黑幕；各門／黑幕的 E 提示位置對（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 2 樓照平面圖重排、浴室也改傳送（黑幕））— 分支 `fix/dorm-c-front-gate`
- 需求（附標註圖）：格局跟平面圖還是不一樣；廁所也跟寢室一樣挪到別處用傳送，入口是黑幕對黑幕按 E；藍框（陽台右邊那扇窗）＝寢室 1，紅框（退縮的戶廳窗）＝交誼廳，盡量符合建築
- `frontend/src/buildings/dormCUnit.ts`：2 樓只剩走廊（沿寢室 1 與交誼廳北側）、雜物間（在走廊西端外側、往南一路到陽台）、交誼廳（紅框那格，北側一條接走廊，寢室 3、4 的門開在這裡，東牆大門）；寢室 1 那格（藍框）只有走廊南牆上的門；浴室搬到地底那棟（`DORM_C_BATH`，邊線要在 0.1 m 格上）。再調整（使用者：廁所門、雜物間門的位置跟平面圖不一樣；灰色 1/4 圓是門的位置）：照草圖每個 1/4 圓重排（橫向每像素約 0.032 m、縱向約 0.029 m）——走廊 x 11.8–15.9；浴室在雜物間北邊、伸到走廊西端上方，門（黑幕）在它南牆東端、開向走廊；雜物間門在東牆開向走廊西端、南牆開到陽台；寢室 2–4 的門在房間中間偏左，寢室 1 的門在右側；大門在交誼廳東牆（`roomDoors` 加 `curtain`）；雜物間變窄，拖把槽移到西牆（原本擋到陽台門）
- `frontend/src/buildings/dormCUnitDecor.ts`：`curtain`（黑幕：深色框、直條褶、橫桿）畫在走廊西端與浴室門口；浴室用地底樓高的框；交誼廳照新格局重排（電視、茶几、沙發、鞋櫃、北牆飲水機、大窗；餐桌會擋門，拿掉）；走廊變短、拿掉鞋櫃
- 測試：`tsc --noEmit`、`vite build` 通過；C3 門口按 E 到 2 樓交誼廳；走廊黑幕按 E 進浴室、浴室黑幕按 E 回走廊；從走廊穿過雜物間的門走到 2 樓陽台；看過浴室、走廊、交誼廳（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 一戶搬到中段 2 樓、曬衣間＝正面 2 樓陽台、寢室改用傳送）— 分支 `fix/dorm-c-front-gate`
- 需求（附標註圖、平面圖）：整戶挪到 C3 正上方 2 樓紅框（花磚陽台＋右邊兩扇窗），走進曬衣間就是 2 樓陽台；空間不夠、寢室與戶廳都被壓小 → 寢室可以放到 C3 任何一處，靠近房門按 E 直接傳送進寢室；戶廳加大、照平面圖比例重排
- `frontend/src/buildings/dormCUnit.ts` 重寫：2 樓這戶（`source`，中段 296668596、`DORM_C_UNIT_FLOOR = 3.6`）平面座標＝正面（edge 5）立面座標（原點 vertex 6、`FRONT_Y = 14` 是正面牆線）；只有浴室、走廊（北牆三扇、南牆一扇寢室門，畫在牆上）、雜物間（南牆門洞 `balconyDoor` 通到真的 2 樓陽台 `balcony`）、交誼廳（加大：陽台右邊那扇窗後面＋退縮戶廳窗後面兩塊，整面跟走廊打通，東牆關著的大門）；四間寢室另成一棟 `rooms`（同一個平面轉換，4.2 × 8.0 m 並排，在地底 `DORM_C_ROOMS_FLOOR = -20`），`roomDoors` 記走廊上的門與寢室內的門
- `frontend/src/buildings/dormCUnitDecor.ts`：參數改吃 `DormCUnit`；`Frame.dy` 讓寢室在另一個樓高；寢室家具照舊（樓梯櫃在房深中間）；走廊牆上畫粉紅寢室門＋門牌；浴室（3 間廁所、東牆 2 洗手台＋鏡、2 小便斗＋百葉通風）、雜物間、走廊鞋櫃、交誼廳（電視、茶几、沙發、餐桌四凳、鞋櫃、飲水機、兩面大窗）照新尺寸；陽台補地板、矮牆、端牆、後牆碰撞；拿掉自己畫的曬衣間
- `frontend/src/buildings/dormCFacade.ts` `laundryRoom`：2 樓陽台東側木門改成真的門洞
- `frontend/src/main.ts`：多建一棟寢室（`unit.rooms`）；寢室門互動改成走廊 ↔ 地底寢室傳送（進去站在門內 1.7 m、面向窗）
- 測試：`tsc --noEmit`、`vite build` 通過；外觀沒有東西穿出中段外牆；C3 門口按 E 到 2 樓交誼廳；走到陽台（看得到花磚與中庭）；走廊按 E 進寢室 4、再按 E 回走廊；看過浴室、交誼廳、走廊（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 寢室門改成畫在牆上的門＋按 E 進出）— 分支 `fix/dorm-c-front-gate`
- 需求（附照片）：門的樣子照照片、要跟牆壁貼齊；門片還是有縫 → 門不要做開關，人物靠近門時一樣按 E 進入房間
- `frontend/src/buildings/dormCUnit.ts`：寢室 1–4 的門洞拿掉（實心牆）；新增 `roomDoors`（門中心與朝走廊的法向）；雜物間改成 `corridor` 類型，門口只是門洞、沒有門片
- `frontend/src/buildings/dormCUnitDecor.ts`：寢室門畫在牆的兩面——粉紅色平板門、深色細邊、圓把手，完全貼平；門上黑色百葉通風口＋白色排風扇，門旁壁燈與開關
- `frontend/src/main.ts`：每扇寢室門兩側各一個互動點（「按 E 進入寢室 N」／「按 E 離開寢室 N」，半徑 0.9 m），淡出後站到門的另一側 1.7 m、面向前進方向
- 測試：`tsc --noEmit`、`vite build` 通過；遊戲裡從走廊按 E 進入寢室 4、再按 E 離開回走廊；看過門的兩面（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 寢室窗戶改成上下兩排）— 分支 `fix/dorm-c-front-gate`
- 需求（附照片）：窗戶分兩部分——書桌上方一整面延伸到對面書桌；床頭上方一樣延伸到另一邊
- `frontend/src/buildings/dormCUnitDecor.ts` `room`：窗牆改成兩排橫向長窗（下排 0.82–1.6 m、兩側書桌之間；上排 2.02–2.52 m、牆到牆、在床頭上方），都有百葉；下排窗下一條窗台；冷氣移到上排窗上方
- 同一輪也在 `loft` 床靠樓梯端加凸起擋板（使用者：床連接到樓梯的地方有擋板）
- 測試：`tsc --noEmit`、`vite build` 通過；遊戲裡看過（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 寢室床靠樓梯端加擋板）— 分支 `fix/dorm-c-front-gate`
- 需求：床連接到樓梯的地方一樣有凸起來的擋板
- `frontend/src/buildings/dormCUnitDecor.ts` `loft`：靠樓梯那一端加一塊整個床深的木擋板（從床板下緣到床面上 0.32 m）
- 測試：`tsc --noEmit`、`vite build` 通過；遊戲裡看過（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 寢室書架相連、窗下櫃改成貼牆材質）— 分支 `fix/dorm-c-front-gate`
- 需求：兩個座位上方的書櫃連在一起；窗下共 4 個櫃子，左右同樣的木頭延伸到書桌下方；櫃子不要凸出牆面——再調整：只做材質、全部跟牆壁貼平
- `frontend/src/buildings/dormCUnitDecor.ts`：`desks` 上方改成一整座 6 欄 × 2 層（每人 3 × 2）；窗下矮櫃拿掉（原本的 `WIN_CAB` 箱體與加厚牆都不用），改成窗牆面上一層木紋貼面（0–0.7 m、整面牆寬、延伸到兩側書桌下），窗下畫出 4 扇櫃門的分縫，完全平貼牆面、沒有碰撞
- 測試：`tsc --noEmit`、`vite build` 通過；遊戲裡看過寢室（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 寢室書桌與窗下櫃）— 分支 `fix/dorm-c-front-gate`
- 需求：一個人的書桌上方書櫃只有六格、桌下抽屜只有兩個；窗下的櫃子內嵌在牆邊、左右延伸到書桌下方
- `frontend/src/buildings/dormCUnitDecor.ts`：`desks` 改成兩人一組——每人上方 3 × 2 格子書架、桌下兩個抽屜、中間隔板；窗下矮櫃改成貼窗牆、整面牆寬（`WIN_CAB` 0.3 m 深、0.68 m 高），一路伸到兩側書桌下方，靠窗那段不放抽屜
- 測試：`tsc --noEmit`、`vite build` 通過；遊戲裡看過寢室（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 寢室照片手工建模、平面等比例放大）— 分支 `fix/dorm-c-front-gate`
- 需求：不要現在的寢室模型；一樣在門口跳出進入選項；平面圖等比例放大，照照片建模、越像越好
- `frontend/src/buildings/dormCUnit.ts`：平面以每像素 0.042 m 等比例放大（一間寢室 4.2 × 8.0、浴室 3.5 × 8.0、走廊 2.7、交誼廳 8.4 × 6.7、曬衣間 9.8 × 6.5、雜物間）；寢室 1 是同一間轉 180°；不再用生成家具（拿掉 `furnish`）、`windows: false`；曬衣間西端與南側改成開口（`open`）；`DORM_C_ROOM_DOOR`
- `frontend/src/buildings/dormCUnitDecor.ts` 重寫：全部照照片手工建模——寢室：柚木色上床下桌，兩側對稱（使用者再調整：衣櫃對衣櫃、書桌對書桌、書桌旁一面長鏡）——再對調：靠窗書桌＋格子書架＋抽屜＋長鏡、靠門衣櫃＋開放書櫃，中間一座層架櫃＋前面斜靠的木梯（使用者照片：中間有櫃子也有梯子；梯子一邊用斜木板直接接書桌、一邊直接靠衣櫃，衣櫃加深到梯腳；門邊一側開放書櫃、一側磁磚牆加鏡子）、床板直接接牆不另加支撐柱（使用者）、金屬圓弧護欄、床墊枕頭、折疊椅、窗＋百葉＋矮櫃＋冷氣、方形日光燈、線槽；浴室：白方磁磚牆、灰色輕鋼架天花、四間磁磚隔間廁所（米色門、蹲式馬桶）、小便斗＋米色隔板＋橘色沖水器、兩個洗手台＋大鏡、高窗與百葉通風窗；曬衣間：花磚牆＋磁磚矮牆、西端矮牆＋長條磁磚洗手台、鐵窗＋高窗、三台洗衣機、深藍曬衣鋼架、不鏽鋼曬衣架、窗外景；雜物間、走廊鞋櫃、交誼廳（電視、茶几、沙發、餐桌、鞋櫃、飲水機）。地板／天花板貼面蓋在生成的上面（生成地板高 0.08 m）
- `frontend/src/main.ts`：只改註解（進入到交誼廳）
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 按 E 進入到交誼廳，逐間看過寢室（含轉向的寢室 1）、浴室、曬衣間、交誼廳（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 寢室改照平面比例、進入後到交誼廳）— 分支 `fix/dorm-c-front-gate`
- 需求：進入宿舍是進入戶廳（交誼廳）；房間與廁所太小——移除舊版，照手繪平面的比例與照片重做（可稍微調整），四間房間一樣
- `frontend/src/buildings/dormCUnit.ts` 重寫：一間寢室 3.3 × 6.3 m 為基準換算（浴室 2.8 × 6.3、寢室 ×4 同尺寸且門在同位置、走廊 2.1、交誼廳 6.6 × 5.2、雜物間、曬衣間 7.8 × 5.1），邊線在家具 0.1 m 格上
- 位置：這個大小放不進東翼外殼，整戶放在東翼正下方地底 `DORM_C_UNIT_FLOOR = -20`（高於 −40 的掉出世界重生線；地圖與故事判斷仍在 C 棟；讀檔會回到戶內）
- 新增 `frontend/src/buildings/dormCUnitDecor.ts`：曬衣間紅色花磚牆、磁磚洗手台與水龍頭、三台洗衣機、曬衣架、天花板曬衣桿；浴室兩個小便斗與隔板（有碰撞）
- `frontend/src/main.ts`：進入後站在交誼廳出入口旁、面向室內；離開提示半徑 1 m（跟到達點分開）；建立／釋放裝飾
- `frontend/src/buildings/dormCFacade.ts`：匯出 `latticeRings`
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 實際按 E 進入（到交誼廳）、按 E 離開（回門廳前）、讀檔回到戶內；看過寢室、曬衣間、浴室（暫時除錯碼已移除）

### 2026-11-23（前端：學生宿舍C 東翼一戶寢室，C3 門口「進入宿舍」）— 分支 `fix/dorm-c-front-gate`
- 需求：依使用者手繪平面與照片設計東翼裡的一戶寢室；靠近 C 棟大門跳出「進入宿舍」直接進房間；選項沿用之前的做法，由我先決定
- 新增 `frontend/src/buildings/dormCUnit.ts`：一戶的平面（BuildingSource），位置由東翼外形算出（西南角、沿南端牆）
  - 北排：浴室（2.2 m 寬）＋寢室 2、3、4（約 2.7 × 5.4 m）；走廊 1.8 m
  - 南排：雜物間在走廊西端下方，曬衣間在東翼西南角（比北排往西凸出），寢室 1，交誼廳（與走廊打通，東牆一樘關著的門）
  - 寢室用 `dormLoft`（四張上床下桌、衣櫃、書桌椅；可躺床、坐椅子），浴室 `restroom`，交誼廳 `discussion`
  - 平面邊線都在家具規劃器的 0.1 m 格上（邊線落在格子中間會被當成牆，廁所隔間擺不進去）
- `frontend/src/buildings/dormCFacade.ts`：`dormCLobbyDoor`、`STOREFRONT` 共用店面分割
- `frontend/src/main.ts`：建立這一戶（手工建築）；「按 E 進入宿舍」在 C3 開著的那樘門前，淡出後站在寢室 1 兩排上床之間、面向房門；「按 E 離開宿舍」在交誼廳出入口，回到門廳前
- `frontend/src/buildings/furniture.ts`：`restroom` 允許 2–2.8 m 寬（隔間 1.15 m、洗手台 0.45 m 深），2.8 m 以上不變
- 決定：一戶放在東翼一樓（東翼外牆不開口，從外面看不到）；從外面走不進去，只能用 E 進出；曬衣間與雜物間先空著（陽台本身在北棟中段有做）
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 實際按 E 進入、看過寢室、浴室、交誼廳與東翼外觀（暫時除錯碼已移除）；「離開宿舍」沒有實際走到那個位置測試

### 2026-11-23（前端：學生宿舍C 北棟門口依正面照重建）— 分支 `fix/dorm-c-front-gate`
- 需求：依使用者的門口照片重新建模 C 棟門口
- `frontend/src/campus/customFacades.ts`：新增 `DORM_C_LOBBY`（陽台正下方那一段、高 3.2 m、往內 4.2 m、地板 0.56 m 與門前平台同高），外牆一樓開口
- `frontend/src/buildings/dormCFacade.ts`：
  - 拿掉出挑雨遮梁，改成內凹楣梁；房間列一樓上方補楣帶
  - 「C3」藍綠色立體字掛在 2F 腰帶上；兩根粗柱底部粗石座
  - 深咖啡色鋁框店面：固定玻璃｜關著的雙開門（把手、告示）｜往外開的雙開門｜固定玻璃，上排氣窗、石材踢腳；透明玻璃
  - `lobbyRoom`：深色地板、白牆綠腰牆、後牆兩扇木門與布告欄、販賣機（亮面朝外）、兩支吊扇、燈；牆與地板有碰撞，可從開著的門走進門廳
  - 外皮在門廳處挖空
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機從照片視角看過（已移除）

### 2026-11-23（前端：學生宿舍C 北棟門廳大門置中）— 分支 `fix/dorm-c-front-gate`
- 需求：使用者說的「大門沒有置中」是北棟一樓門廳的棕框雙開門（截圖紅線，「C」字正下方），不是中庭的前門
- `frontend/src/buildings/dormCFacade.ts`：雙開門改在門廳正中，對齊「C」字與地上紅磚帶
- 中庭前門（dormYard）：前兩輪因誤會而移到東翼轉角與旁棟缺口正中，使用者要求改回原本的位置——`ends` 改回東翼東移前的原端點（10.92, 327.66）–（8.57, 319.27）
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機從使用者截圖視角看過（已移除）

### 2026-11-23（前端：學生宿舍C 前門位置固定、東翼凹口牆改實心）— 分支 `fix/dorm-c-front-gate`
- 需求：C 棟大門位置飄掉；地圖上紅框處（東翼面向戶廳的凹口牆）的戶廳窗不要、換成牆
- 原因：前門的圍牆端點是執行時找兩翼最近點；東翼東移 1.6 m 後，門的中心往東 1.4 m 並轉了角度，跟固定位置的步道、廣場錯開
- `frontend/src/campus/dormYard.ts`：`GateMark.ends`，C 前門固定牆端點；先固定回原端點，使用者說沒有置中，改成從東翼轉角（10.15, 318.99）沿原圍牆角度到旁棟南牆（12.52, 327.43），門在缺口正中、步道跟著門
- `frontend/src/buildings/dormCFacade.ts`：東翼凹口的西向牆改實心
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機看過前門與凹口（已移除）

### 2026-11-23（前端：學生宿舍C 右側戶廳改 4 層、整棟往東加長 1.6 m）— 分支 `fix/dorm-c-front-gate`
- 需求：右側戶廳要 4 層，露出比例跟左側差不多；可以增加整體長度、不必完全照平面，但不要超出太多
- `frontend/src/campus/customFacades.ts`：`DORM_C.eastShift = 1.6`；`DORM_C_PIECES` 東翼改用移動後的點（4s…11s、Q）；分界牆、手工立面邊號、陽台邊號（edge 5）更新
- `frontend/src/campus/campusFixes.ts`：`splitDormC` 東翼頂點沿正面往東移 1.6 m；原凹口北面併入中段（4 層戶廳，約 5.9 m，左側約 5.75 m）
- `frontend/src/buildings/dormCFacade.ts`：錨點更新；右側戶廳用中段 4 層高度
- 檢查：東翼東牆離腳踏車棚至少約 1.7 m、C 前門圍牆仍接在東翼東南角
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機看過正面與空拍（已移除）

### 2026-11-23（前端：學生宿舍C 北棟正面右側加房間、縮小戶廳與曬衣間）— 分支 `fix/dorm-c-front-gate`
- 需求：截圖紅框（左側戶廳＋房間）複製到右邊藍框；戶廳和洗衣間縮小，房間窗戶比例不動
- `frontend/src/campus/customFacades.ts`：`DORM_C_BALCONY.a0 = roomWidth + 1`，陽台東端讓出一間房
- `frontend/src/buildings/dormCFacade.ts`：凸出段右端加房間列（同左側）；陽台開口端 1.3 m；戶廳窗 `HALL_WINDOW` 2.4 m 置中、兩旁實牆；東側凹口朝中庭那面改回戶廳；曬衣架縮短配合較短的陽台
- 測試：`tsc --noEmit`、`vite build` 通過；dev server 暫時除錯相機從使用者截圖視角看過（已移除）

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
