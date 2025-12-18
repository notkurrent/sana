import pytest
from typing import AsyncGenerator
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool

from main import app
from app.models.sql import Base
from app.dependencies import get_session

TEST_DATABASE_URL = "postgresql+asyncpg://postgres:password@localhost:5432/sana_test"


# 1. ДВИЖОК + ТАБЛИЦЫ (Запускается для КАЖДОГО теста заново)
@pytest.fixture(scope="function")
async def db_engine():
    # Создаем движок
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)

    # Создаем таблицы
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    # Удаляем таблицы и закрываем движок
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


# 2. СЕССИЯ
@pytest.fixture(scope="function")
async def session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    async_session_maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with async_session_maker() as session:
        yield session
        # Важно: закрываем сессию корректно
        await session.close()


# 3. КЛИЕНТ API
@pytest.fixture(scope="function")
async def client(session):
    app.dependency_overrides[get_session] = lambda: session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
