"""
Settings, read from environment variables. For local work you can put them in a .env file at
the repo root (copy .env.example). For a hosted instance, set them in the host's environment.
Real passwords and tokens never go in git.

  POSTGRES_PASSWORD  database password (docker-compose reads the same variable)
  DATABASE_URL       full connection string; overrides POSTGRES_PASSWORD when set
  CORS_ORIGINS       comma-separated browser origins allowed to call the API ("*" = any)
  ENABLE_UPLOADS     "false" turns off POST /api/datasets (recommended on a public instance)
  UPLOAD_TOKEN       if set, uploads need header X-Upload-Token with this value
  ADMIN_TOKEN        if set, lets an admin delete any user-submitted dataset (X-Admin-Token)
"""
import os
from pathlib import Path
from urllib.parse import quote_plus

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env reader; real environment variables always win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


_load_dotenv()

POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "gridlock")          # local dev default only
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql+psycopg2://gridlock:{quote_plus(POSTGRES_PASSWORD)}@localhost:5433/gridlock")
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS",
    "http://localhost:8000,http://127.0.0.1:8000,http://localhost:5173,http://localhost:3000",
).split(",") if o.strip()]
ENABLE_UPLOADS = _flag("ENABLE_UPLOADS", "true")
UPLOAD_TOKEN = os.getenv("UPLOAD_TOKEN") or None
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN") or None
