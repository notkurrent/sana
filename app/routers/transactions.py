from fastapi import APIRouter, Depends, HTTPException, Header
from typing import List, Optional, Union
from datetime import datetime, timedelta, timezone
from app.database import get_db
from app.dependencies import verify_telegram_authentication
from app.models.schemas import Transaction, TransactionCreate, TransactionUpdate

router = APIRouter(tags=["transactions"])


# --- Helper: Фильтрация дат ---
def _get_date_range_filter(range_str: str, timezone_offset_str: Optional[str] = None):
    if range_str == "all":
        return "", []

    server_now = datetime.now(timezone.utc)
    offset_minutes = 0
    if timezone_offset_str and timezone_offset_str.lstrip("-").isdigit():
        offset_minutes = int(timezone_offset_str)
        user_now = server_now - timedelta(minutes=offset_minutes)
    else:
        user_now = server_now

    start_date_dt = None
    if range_str == "day":
        start_date_dt = user_now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_str == "week":
        start_date_dt = (user_now - timedelta(days=user_now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    elif range_str == "month":
        start_date_dt = user_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif range_str == "year":
        start_date_dt = user_now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    if start_date_dt:
        query_start_utc = start_date_dt + timedelta(minutes=offset_minutes)
        query_start_utc = query_start_utc.replace(tzinfo=None)
        return " AND t.date >= %s", [query_start_utc]
    return "", []


# --- Helper: Коррекция даты при сохранении ---
def _get_date_for_storage(date_str: str, timezone_offset_str: Optional[str]) -> str:
    if not date_str:
        return datetime.now(timezone.utc).isoformat()
    try:
        selected_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        server_now = datetime.now(timezone.utc)

        user_now = server_now
        if timezone_offset_str and timezone_offset_str.lstrip("-").isdigit():
            offset_minutes = int(timezone_offset_str)
            user_now = server_now - timedelta(minutes=offset_minutes)

        if selected_date == user_now.date():
            return server_now.isoformat()
        return date_str
    except:
        return date_str


# --- Endpoints ---


@router.get("/transactions", response_model=List[Transaction])
async def get_transactions(
    limit: int = 50, offset: int = 0, user=Depends(verify_telegram_authentication), db=Depends(get_db)
):
    user_id = user["id"]
    query = """
        SELECT t.id, t.amount, c.name as category, c.type, t.date, t.category_id 
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = %s 
        ORDER BY t.date DESC, t.id DESC 
        LIMIT %s OFFSET %s
    """
    db.execute(query, (user_id, limit, offset))
    return db.fetchall()


@router.post("/transactions")
async def add_transaction(
    tx: TransactionCreate,
    user=Depends(verify_telegram_authentication),
    db=Depends(get_db),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]
    final_date = _get_date_for_storage(str(tx.date), x_timezone_offset)

    try:
        db.execute(
            """
            INSERT INTO transactions (user_id, amount, category_id, date) 
            VALUES (%s, %s, %s, %s) 
            RETURNING id
            """,
            (user_id, tx.amount, tx.category_id, final_date),
        )
        new_id = db.fetchone()["id"]
        return {"id": new_id, "status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/transactions/{tx_id}")
async def update_transaction(
    tx_id: int,
    update: TransactionUpdate,
    user=Depends(verify_telegram_authentication),
    db=Depends(get_db),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]

    fields = []
    values = []

    if update.amount is not None:
        fields.append("amount = %s")
        values.append(update.amount)

    if update.category_id is not None:
        fields.append("category_id = %s")
        values.append(update.category_id)

    if update.date is not None:
        # 🔥 ФИКС: Сначала получаем оригинальную транзакцию, чтобы сохранить время!
        db.execute("SELECT date FROM transactions WHERE id = %s AND user_id = %s", (tx_id, user_id))
        original_tx = db.fetchone()

        if original_tx:
            original_dt = original_tx["date"]  # datetime из БД

            # Приводим новую дату к объекту date (она может прийти строкой или datetime)
            new_date_val = update.date
            if isinstance(new_date_val, str):
                try:
                    # Отрезаем время, если оно вдруг прилетело в строке, берем только дату
                    new_date_val = datetime.strptime(new_date_val.split("T")[0], "%Y-%m-%d").date()
                except ValueError:
                    # Если формат странный, пробуем стандартный парсер или fallback
                    new_date_val = datetime.now().date()
            elif isinstance(new_date_val, datetime):
                new_date_val = new_date_val.date()

            # 🛠 ГЛАВНАЯ МАГИЯ: Берем старое время и склеиваем с новой датой
            final_dt = original_dt.replace(year=new_date_val.year, month=new_date_val.month, day=new_date_val.day)

            fields.append("date = %s")
            values.append(final_dt)
        else:
            # Если вдруг транзакцию не нашли (странно, но бывает), используем старый метод
            final_date = _get_date_for_storage(str(update.date), x_timezone_offset)
            fields.append("date = %s")
            values.append(final_date)

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    values.append(tx_id)
    values.append(user_id)

    query = f"UPDATE transactions SET {', '.join(fields)} WHERE id = %s AND user_id = %s"
    db.execute(query, tuple(values))

    if db.rowcount == 0:
        raise HTTPException(status_code=404, detail="Transaction not found or access denied")

    return {"status": "updated"}


@router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: int, user=Depends(verify_telegram_authentication), db=Depends(get_db)):
    user_id = user["id"]
    db.execute("DELETE FROM transactions WHERE id = %s AND user_id = %s", (tx_id, user_id))
    return {"status": "deleted"}


@router.delete("/users/me/reset")
async def reset_user_data(user=Depends(verify_telegram_authentication), db=Depends(get_db)):
    user_id = user["id"]
    db.execute("DELETE FROM transactions WHERE user_id = %s", (user_id,))
    db.execute("DELETE FROM categories WHERE user_id = %s", (user_id,))
    return {"status": "success"}


# --- Analytics Endpoints ---


@router.get("/analytics/summary")
async def get_summary(
    type: str = "expense",
    range: str = "month",
    user=Depends(verify_telegram_authentication),
    db=Depends(get_db),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]
    query = """
        SELECT c.name as category, SUM(t.amount) as total 
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = %s AND c.type = %s
    """
    params = [user_id, type]

    filter_sql, filter_params = _get_date_range_filter(range, x_timezone_offset)
    query += filter_sql
    params.extend(filter_params)

    query += " GROUP BY c.name HAVING SUM(t.amount) > 0 ORDER BY total DESC"
    db.execute(query, tuple(params))
    return db.fetchall()


@router.get("/analytics/calendar")
async def get_calendar_data(
    month: int,
    year: int,
    user=Depends(verify_telegram_authentication),
    db=Depends(get_db),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    user_id = user["id"]
    offset = int(x_timezone_offset) if x_timezone_offset and x_timezone_offset.lstrip("-").isdigit() else 0

    # 1. Месяц
    query_month = """
        SELECT c.type, SUM(t.amount) as total
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = %s 
          AND EXTRACT(MONTH FROM (t.date - (%s * INTERVAL '1 minute'))) = %s 
          AND EXTRACT(YEAR FROM (t.date - (%s * INTERVAL '1 minute'))) = %s
        GROUP BY c.type
    """
    db.execute(query_month, (user_id, offset, month, offset, year))
    rows = db.fetchall()

    summary = {"income": 0, "expense": 0, "net": 0}
    for r in rows:
        val = r["total"] or 0
        if r["type"] == "income":
            summary["income"] = val
        if r["type"] == "expense":
            summary["expense"] = val
    summary["net"] = summary["income"] - summary["expense"]

    # 2. Дни
    query_days = """
        SELECT TO_CHAR(t.date - (%s * INTERVAL '1 minute'), 'YYYY-MM-DD') as date, c.type, SUM(t.amount) as total
        FROM transactions t 
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = %s 
          AND EXTRACT(MONTH FROM (t.date - (%s * INTERVAL '1 minute'))) = %s 
          AND EXTRACT(YEAR FROM (t.date - (%s * INTERVAL '1 minute'))) = %s
        GROUP BY date, c.type ORDER BY date
    """
    db.execute(query_days, (offset, user_id, offset, month, offset, year))

    days = {}
    for r in db.fetchall():
        d = r["date"]
        if d not in days:
            days[d] = {"income": 0, "expense": 0}
        days[d][r["type"]] = r["total"] or 0

    return {"month_summary": summary, "days": days}
