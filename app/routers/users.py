from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.dependencies import verify_telegram_authentication, get_session
from app.models.sql import UserDB, TransactionDB
from app.services.currency import CurrencyService

router = APIRouter(tags=["users"])


# Pydantic схема для входящего запроса
class UserSettingsUpdate(BaseModel):
    base_currency: str


@router.post("/users/me/settings/currency")
async def update_base_currency(
    settings: UserSettingsUpdate,
    user_data=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
):
    """
    Меняет базовую валюту пользователя и запускает пересчет (Soft Recalculation)
    всех исторических транзакций.
    """
    user_id = user_data["id"]
    new_currency = settings.base_currency.upper()

    # 1. Находим пользователя в базе
    stmt = select(UserDB).where(UserDB.id == user_id)
    result = await session.execute(stmt)
    user_db = result.scalar_one_or_none()

    # Если пользователя нет - создаем
    if not user_db:
        user_db = UserDB(id=user_id, base_currency="USD")
        session.add(user_db)

    # Если валюта та же самая — ничего не делаем
    if user_db.base_currency == new_currency:
        return {"status": "no_change", "currency": new_currency}

    # 2. Обновляем валюту пользователя
    user_db.base_currency = new_currency

    # 3. 🔥 SOFT RECALCULATION: Пересчитываем всю историю
    # Получаем все транзакции пользователя
    tx_stmt = select(TransactionDB).where(TransactionDB.user_id == user_id)
    tx_result = await session.execute(tx_stmt)
    transactions = tx_result.scalars().all()

    currency_service = CurrencyService()

    count = 0
    for tx in transactions:
        # Если original_amount нет (старая запись), считаем текущий amount за оригинал
        # И предполагаем, что старая валюта была USD (или та, что записана в currency, если есть)
        base_val = tx.original_amount if tx.original_amount is not None else tx.amount

        # Валюта транзакции (в чем реально платили, напр. TRY)
        source_currency = tx.currency

        # Считаем курс: Из Валюты Траты (TRY) -> В Новую Базовую (KZT)
        rate = await currency_service.get_rate(source_currency, new_currency)

        # Обновляем поле статистики (amount)
        tx.amount = base_val * rate
        count += 1

    await session.commit()

    return {"status": "updated", "recalculated_transactions": count, "new_currency": new_currency}


@router.get("/users/me")
async def get_user_profile(
    user_data=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
):
    """Возвращает профиль пользователя с его настройками"""
    user_id = user_data["id"]
    stmt = select(UserDB).where(UserDB.id == user_id)
    result = await session.execute(stmt)
    user_db = result.scalar_one_or_none()

    # Если юзера нет в базе, возвращаем дефолт (USD)
    if not user_db:
        return {"id": user_id, "base_currency": "USD"}

    return {"id": user_db.id, "base_currency": user_db.base_currency}
