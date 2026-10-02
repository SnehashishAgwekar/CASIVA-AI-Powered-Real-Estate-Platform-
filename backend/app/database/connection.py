import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Create the SQLAlchemy database engine. Supabase drops idle connections, so
# ping before reuse and recycle periodically -- otherwise the first query after
# an idle spell fails with "SSL connection has been closed unexpectedly".
engine = create_engine(DATABASE_URL, echo=True, pool_pre_ping=True, pool_recycle=300)

# Create a session factory to manage transactions
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for our database models
Base = declarative_base()

def get_db():
    """
    Dependency that provides a database session per request 
    and closes it when finished.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()