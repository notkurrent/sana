from fastapi import APIRouter, Depends, HTTPException, Header
from typing import List, Optional, Union
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, func, case, text, desc

from app.dependencies import verify_telegram_authentication, get_session
from app.models.schemas import Transaction, TransactionCreate, TransactionUpdate
from app.models.sql import TransactionDB, CategoryDB

router = APIRouter(tags=["transactions"])


# --- Helpers (Оставляем как есть, логика питона не меняется) ---
def _get_date_for_storage(date_str: str, timezone_offset_str: Optional[str]) -> datetime:
    if not date_str:
        return datetime.now(timezone.utc)
    try:
        # Если пришла строка, пробуем парсить
        if isinstance(date_str, str):
            selected_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        else:
            selected_date = date_str  # Если Pydantic уже дал date object

        server_now = datetime.now(timezone.utc)

        # Логика "Если сегодня, то ставим текущее время"
        user_now = server_now
        if timezone_offset_str and timezone_offset_str.lstrip("-").isdigit():
            offset_minutes = int(timezone_offset_str)
            user_now = server_now - timedelta(minutes=offset_minutes)

        if selected_date == user_now.date():
            return server_now.replace(tzinfo=None)  # Postgres хранит без таймзоны (naive)

        # Иначе начало дня
        return datetime.combine(selected_date, datetime.min.time())
    except Exception as e:
        print(f"Date parse error: {e}")
        return datetime.now(timezone.utc).replace(tzinfo=None)


# --- Endpoints ---


@router.get("/transactions", response_model=List[Transaction])
async def get_transactions(
    limit: int = 50,
    offset: int = 0,
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
):
    user_id = user["id"]

    # 🔥 JOIN запрос на ORM
    stmt = (
        select(
            TransactionDB.id,
            TransactionDB.amount,
            TransactionDB.date,
            TransactionDB.category_id,
            CategoryDB.name.label("category"),  # Алиасы для Pydantic
            CategoryDB.type,
        )
        .join(CategoryDB, TransactionDB.category_id == CategoryDB.id)
        .where(TransactionDB.user_id == user_id)
        .order_by(desc(TransactionDB.date), desc(TransactionDB.id))
        .limit(limit)
        .offset(offset)
    )

    result = await session.execute(stmt)
    # mappings() превращает результат в словарь, который Pydantic легко съест
    return result.mappings().all()


@router.get("/balance")
async def get_total_balance(user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)):
    user_id = user["id"]

    # Считаем сумму с условием (Income - Expense)
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

    new_tx = TransactionDB(user_id=user_id, amount=tx.amount, category_id=tx.category_id, date=final_date)

    session.add(new_tx)
    try:
        await session.commit()
        await session.refresh(new_tx)  # Получаем ID
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

    # 1. Проверяем, существует ли транзакция
    stmt = select(TransactionDB).where((TransactionDB.id == tx_id) & (TransactionDB.user_id == user_id))
    result = await session.execute(stmt)
    transaction = result.scalar_one_or_none()

    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # 2. Обновляем поля
    if update_data.amount is not None:
        transaction.amount = update_data.amount

    if update_data.category_id is not None:
        transaction.category_id = update_data.category_id

    if update_data.date is not None:
        # Логика сохранения времени при смене даты
        new_date_val = _get_date_for_storage(update_data.date, x_timezone_offset)
        # Если хотим сохранить оригинальное время (ч/м/с), нужно сложнее,
        # но для простоты берем логику helper-функции
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
    # Удаляем транзакции
    await session.execute(delete(TransactionDB).where(TransactionDB.user_id == user_id))
    # Удаляем категории
    await session.execute(delete(CategoryDB).where(CategoryDB.user_id == user_id))
    await session.commit()
    return {"status": "success"}


# --- Analytics Endpoints ---
# Используем text() для сложной логики дат, чтобы не ломать то, что работает


@router.get("/analytics/summary")
async def get_summary(
    type: str = "expense",
    range: str = "month",
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]

    # Расчет параметров времени
    server_now = datetime.now(timezone.utc)
    offset_minutes = 0
    if x_timezone_offset and x_timezone_offset.lstrip("-").isdigit():
        offset_minutes = int(x_timezone_offset)

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

    # Используем text() для гибкости
    query_str = """
        SELECT c.name as category, SUM(t.amount) as total 
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = :user_id AND c.type = :type
    """
    params = {"user_id": user_id, "type": type}

    if start_date:
        # Приводим к UTC для сравнения с базой
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

    # 1. Месяц (Raw SQL через text, так как INTERVAL синтаксис проще в SQL)
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

    # 2. Дни
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
        days[d][r["type"]] = r["total"] or 0

    return {"month_summary": summary, "days": days}
