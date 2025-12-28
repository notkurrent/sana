from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_session, verify_telegram_authentication
from app.models.sql import TransactionDB, UserDB
from app.services.currency import CurrencyService

router = APIRouter(tags=["users"])


class UserSettingsUpdate(BaseModel):
    base_currency: str


@router.post("/users/me/settings/currency")
async def update_base_currency(
    settings: UserSettingsUpdate,
    user_data=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
):
    """
    Updates the user's base currency and triggers a soft recalculation
    of all historical transactions.
    """
    user_id = user_data["id"]
    new_currency = settings.base_currency.upper()

    stmt = select(UserDB).where(UserDB.id == user_id)
    result = await session.execute(stmt)
    user_db = result.scalar_one_or_none()

    if not user_db:
        user_db = UserDB(id=user_id, base_currency="USD")
        session.add(user_db)

    if user_db.base_currency == new_currency:
        return {"status": "no_change", "currency": new_currency}

    user_db.base_currency = new_currency

    # Recalculate all historical transactions
    tx_stmt = select(TransactionDB).where(TransactionDB.user_id == user_id)
    tx_result = await session.execute(tx_stmt)
    transactions = tx_result.scalars().all()

    currency_service = CurrencyService()

    count = 0
    for tx in transactions:
        # Handle legacy data: fallback to current amount if original is missing
        base_val = tx.original_amount if tx.original_amount is not None else tx.amount
        source_currency = tx.currency

        # Calculate rate: Source Currency -> New Base Currency
        rate = await currency_service.get_rate(source_currency, new_currency)

        tx.amount = base_val * rate
        count += 1

    await session.commit()

    return {"status": "updated", "recalculated_transactions": count, "new_currency": new_currency}


@router.get("/users/me")
async def get_user_profile(
    user_data=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
):
    user_id = user_data["id"]
    stmt = select(UserDB).where(UserDB.id == user_id)
    result = await session.execute(stmt)
    user_db = result.scalar_one_or_none()

    # Return default profile if user not found in DB
    if not user_db:
        return {"id": user_id, "base_currency": "USD"}

    return {"id": user_db.id, "base_currency": user_db.base_currency}
