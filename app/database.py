from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import DATABASE_URL

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800,  # Recycle connections every 30 minutes to prevent timeouts
    pool_pre_ping=True,  # Check connection liveness before usage (critical for cloud DBs)
)

async_session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
