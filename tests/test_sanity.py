import pytest
from sqlalchemy import text
from app.models.sql import UserDB


# Проверяем, что база живая и таблицы создались
@pytest.mark.asyncio
async def test_database_connection(session):
    # 1. Пробуем выполнить простой SQL запрос
    result = await session.execute(text("SELECT 1"))
    assert result.scalar() == 1


# Проверяем, что таблицы создались (попробуем найти юзера)
@pytest.mark.asyncio
async def test_tables_exist(session):
    # Если таблица не существует, тут вылетит ошибка
    # Если существует - вернется пустой результат (None), и это ОК
    result = await session.get(UserDB, "non-existent-id")
    assert result is None
