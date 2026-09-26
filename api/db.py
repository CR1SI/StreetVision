"""SQLAlchemy engine. Override the connection with the DATABASE_URL environment variable."""
import os

from sqlalchemy import create_engine

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://gridlock:gridlock@localhost:5433/gridlock")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
