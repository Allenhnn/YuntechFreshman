"""後端入口。

啟動方式（在 backend/ 資料夾）：
    uv run python -m app.main       # 用 uvicorn 啟動（設定見 .env 的 APP_*）
    uv run app/main.py              # 同上，直接執行檔案也可以
    uv run fastapi dev app/main.py  # FastAPI CLI 也仍可使用
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if __package__ in (None, ""):  # 直接執行 app/main.py 時，讓 `import app` 找得到
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import get_settings  # noqa: E402
from app.factory import create_app  # noqa: E402

app = create_app()


def run() -> None:
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "app.main:app",
        host=s.app_host,
        port=s.app_port,
        reload=s.app_reload,
        app_dir=str(BACKEND_DIR),
        reload_dirs=[str(BACKEND_DIR / "app")] if s.app_reload else None,
    )


if __name__ == "__main__":
    run()
