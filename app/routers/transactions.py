from fastapi import APIRouter, Depends, HTTPException, Header
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, case, text, desc

# 🔥 ВАЖНО: Добавили специальный импорт для безопасной вставки (Upsert)
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.dependencies import verify_telegram_authentication, get_session
from app.models.schemas import Transaction, TransactionCreate, TransactionUpdate
from app.models.sql import TransactionDB, CategoryDB, UserDB
from app.services.currency import CurrencyService

router = APIRouter(tags=["transactions"])


# --- Helpers ---
def _get_date_for_storage(date_input: str | datetime, timezone_offset_str: Optional[str]) -> datetime:
    """
    Преобразует дату от пользователя в UTC datetime для сохранения в БД.
    Исправлен баг с потерей времени при редактировании.
    """
    if not date_input:
        return datetime.now(timezone.utc)

    try:
        # 1. Если это уже datetime, просто приводим к UTC
        if isinstance(date_input, datetime):
            return date_input.astimezone(timezone.utc)

        # 2. Если это строка
        if isinstance(date_input, str):
            # A. Пробуем ISO формат (с временем) -> "2023-10-10T14:30:00"
            if "T" in date_input:
                dt = datetime.fromisoformat(date_input.replace("Z", "+00:00"))
                return dt.astimezone(timezone.utc)

            # B. Пробуем просто дату -> "2023-10-10" (ставим время 00:00 с учетом часового пояса юзера)
            selected_date = datetime.strptime(date_input, "%Y-%m-%d").date()

            server_now = datetime.now(timezone.utc)

            # Определяем "сейчас" у пользователя
            user_now = server_now
            if timezone_offset_str and timezone_offset_str.lstrip("-").isdigit():
                offset_minutes = int(timezone_offset_str)
                user_now = server_now - timedelta(minutes=offset_minutes)

            # Если пользователь выбрал "сегодня" по своему календарю — ставим точное серверное время
            if selected_date == user_now.date():
                return server_now

            # Иначе ставим начало дня (00:00)
            return datetime.combine(selected_date, datetime.min.time()).replace(tzinfo=timezone.utc)

        return datetime.now(timezone.utc)

    except Exception as e:
        print(f"Date parse error: {e}")
        return datetime.now(timezone.utc)


# --- Endpoints ---


@router.get("/transactions", response_model=List[Transaction])
async def get_transactions(
    limit: int = 50,
    offset: int = 0,
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
):
    user_id = user["id"]

    stmt = (
        select(
            TransactionDB.id,
            TransactionDB.amount,
            TransactionDB.original_amount,
            TransactionDB.currency,
            TransactionDB.date,
            TransactionDB.category_id,
            TransactionDB.note,  # 🔥 Load Note
            CategoryDB.name.label("category"),
            CategoryDB.type,
        )
        .join(CategoryDB, TransactionDB.category_id == CategoryDB.id)
        .where(TransactionDB.user_id == user_id)
        .order_by(desc(TransactionDB.date), desc(TransactionDB.id))
        .limit(limit)
        .offset(offset)
    )

    result = await session.execute(stmt)
    return result.mappings().all()


@router.get("/balance")
async def get_total_balance(user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)):
    user_id = user["id"]

    stmt = (
        select(func.sum(case((CategoryDB.type == "income", TransactionDB.amount), else_=-TransactionDB.amount)))
        .join(CategoryDB)
        .where(TransactionDB.user_id == user_id)
    )

    result = await session.execute(stmt)
    balance = result.scalar() or 0.0
    return {"balance": balance}


@router.post("/transactions")
async def add_transaction(
    tx: TransactionCreate,
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]
    final_date = _get_date_for_storage(tx.date, x_timezone_offset)

    # --- 🔥 FIX START: БЕЗОПАСНОЕ СОЗДАНИЕ ЮЗЕРА (Race Condition Fix) ---
    insert_stmt = (
        pg_insert(UserDB).values(id=user_id, base_currency="USD").on_conflict_do_nothing(index_elements=["id"])
    )
    await session.execute(insert_stmt)

    user_stmt = select(UserDB).where(UserDB.id == user_id)
    result = await session.execute(user_stmt)
    user_db = result.scalar_one()
    target_currency = user_db.base_currency
    # --- 🔥 FIX END ---

    # 3. Логика конвертации
    currency_service = CurrencyService()
    rate = await currency_service.get_rate(tx.currency, target_currency)
    amount_in_base = tx.amount * rate

    new_tx = TransactionDB(
        user_id=user_id,
        original_amount=tx.amount,
        currency=tx.currency,
        amount=amount_in_base,
        category_id=tx.category_id,
        date=final_date,
        note=tx.note,  # 🔥 Save Note
    )

    session.add(new_tx)
    try:
        await session.commit()
        await session.refresh(new_tx)
        return {"id": new_tx.id, "status": "saved"}
    except Exception as e:
        await session.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/transactions/{tx_id}")
async def update_transaction(
    tx_id: int,
    update_data: TransactionUpdate,
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]

    stmt = select(TransactionDB).where((TransactionDB.id == tx_id) & (TransactionDB.user_id == user_id))
    result = await session.execute(stmt)
    transaction = result.scalar_one_or_none()

    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    should_recalculate = False

    if update_data.amount is not None:
        transaction.original_amount = update_data.amount
        should_recalculate = True

    if update_data.currency is not None:
        transaction.currency = update_data.currency
        should_recalculate = True

    # 🔥 ПЕРЕСЧЕТ С УЧЕТОМ ВАЛЮТЫ ЮЗЕРА
    if should_recalculate:
        user_stmt = select(UserDB).where(UserDB.id == user_id)
        u_result = await session.execute(user_stmt)
        user_db = u_result.scalar_one_or_none()
        target_currency = user_db.base_currency if user_db else "USD"

        service = CurrencyService()

        base_val = transaction.original_amount if transaction.original_amount is not None else transaction.amount
        rate = await service.get_rate(transaction.currency, target_currency)

        transaction.amount = base_val * rate

    if update_data.category_id is not None:
        transaction.category_id = update_data.category_id

    if update_data.note is not None:  # 🔥 Update Note
        transaction.note = update_data.note

    if update_data.date is not None:
        new_date_val = _get_date_for_storage(update_data.date, x_timezone_offset)
        transaction.date = new_date_val

    await session.commit()
    return {"status": "updated"}


@router.delete("/transactions/{tx_id}")
async def delete_transaction(
    tx_id: int, user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]
    stmt = delete(TransactionDB).where((TransactionDB.id == tx_id) & (TransactionDB.user_id == user_id))
    await session.execute(stmt)
    await session.commit()
    return {"status": "deleted"}


@router.delete("/users/me/reset")
async def reset_user_data(user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)):
    user_id = user["id"]
    await session.execute(delete(TransactionDB).where(TransactionDB.user_id == user_id))
    await session.execute(delete(CategoryDB).where(CategoryDB.user_id == user_id))
    await session.execute(delete(UserDB).where(UserDB.id == user_id))
    await session.commit()
    return {"status": "success"}


# --- Analytics Endpoints ---


@router.get("/analytics/summary")
async def get_summary(
    type: str = "expense",
    range: str = "month",
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]
    server_now = datetime.now(timezone.utc)
    offset_minutes = int(x_timezone_offset) if x_timezone_offset and x_timezone_offset.lstrip("-").isdigit() else 0

    user_now = server_now - timedelta(minutes=offset_minutes)

    start_date = None
    if range == "day":
        start_date = user_now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range == "week":
        start_date = (user_now - timedelta(days=user_now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif range == "month":
        start_date = user_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif range == "year":
        start_date = user_now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    query_str = """
        SELECT c.name as category, SUM(t.amount) as total 
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = :user_id AND c.type = :type
    """
    params = {"user_id": user_id, "type": type}

    if start_date:
        query_start_utc = (start_date + timedelta(minutes=offset_minutes)).replace(tzinfo=None)
        query_str += " AND t.date >= :start_date"
        params["start_date"] = query_start_utc

    query_str += " GROUP BY c.name HAVING SUM(t.amount) > 0 ORDER BY total DESC"

    result = await session.execute(text(query_str), params)
    return result.mappings().all()


@router.get("/analytics/calendar")
async def get_calendar_data(
    month: int,
    year: int,
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]
    offset = int(x_timezone_offset) if x_timezone_offset and x_timezone_offset.lstrip("-").isdigit() else 0
    params = {"user_id": user_id, "month": month, "year": year, "offset": offset}

    query_month = text(
        """
        SELECT c.type, SUM(t.amount) as total
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = :user_id 
          AND EXTRACT(MONTH FROM (t.date - (:offset * INTERVAL '1 minute'))) = :month 
          AND EXTRACT(YEAR FROM (t.date - (:offset * INTERVAL '1 minute'))) = :year
        GROUP BY c.type
    """
    )
    result_month = await session.execute(query_month, params)
    rows = result_month.mappings().all()

    summary = {"income": 0, "expense": 0, "net": 0}
    for r in rows:
        val = r["total"] or 0
        if r["type"] == "income":
            summary["income"] = val
        if r["type"] == "expense":
            summary["expense"] = val
    summary["net"] = summary["income"] - summary["expense"]

    query_days = text(
        """
        SELECT TO_CHAR(t.date - (:offset * INTERVAL '1 minute'), 'YYYY-MM-DD') as date, c.type, SUM(t.amount) as total
        FROM transactions t 
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = :user_id 
          AND EXTRACT(MONTH FROM (t.date - (:offset * INTERVAL '1 minute'))) = :month 
          AND EXTRACT(YEAR FROM (t.date - (:offset * INTERVAL '1 minute'))) = :year
        GROUP BY date, c.type ORDER BY date
    """
    )
    result_days = await session.execute(query_days, params)

    days = {}
    for r in result_days.mappings():
        d = r["date"]
        if d not in days:
            days[d] = {"income": 0, "expense": 0}
        days[d][r["type"]] += r["total"] or 0

    return {"month_summary": summary, "days": days}
