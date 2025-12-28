import pytest
from sqlalchemy import text

from app.models.sql import UserDB


@pytest.mark.asyncio
async def test_database_connection(session):
    result = await session.execute(text("SELECT 1"))
    assert result.scalar() == 1


@pytest.mark.asyncio
async def test_tables_exist(session):
    # Should not raise ProgrammingError if table exists
    result = await session.get(UserDB, "non-existent-id")
    assert result is None
