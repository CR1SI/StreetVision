"""SQLAlchemy engine. The connection comes from api/config.py (DATABASE_URL / POSTGRES_PASSWORD)."""
from sqlalchemy import create_engine

from api.config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
