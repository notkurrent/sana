from fastapi import APIRouter, Depends, HTTPException, Header, Query
import google.generativeai as genai
from typing import Optional
from datetime import datetime, timedelta, timezone

from app.config import GOOGLE_API_KEY
from app.database import get_db
from app.dependencies import verify_telegram_authentication

router = APIRouter(tags=["ai"])

# 🔥 ТВОИ ПРОМПТЫ + ЗАЩИТА ОТ MARKDOWN
PROMPTS = {
    "summary": (
        "You are a concise financial analyst. Analyze the following transactions for the period. "
        "Write a very short (2-3 sentences) summary. "
        "Start with the total expenses and total income. "
        "Then, list the top 2-3 EXPENSE categories and their totals. "
        "Use the user's currency symbol where appropriate (e.g., $, ₸, €, etc. if you see it in the amounts). "
        "IMPORTANT: Do not use markdown formatting (no bold **, no italics *). Just plain text.\n\n"
        "Transactions:\n{transaction_list_str}\n"
        "Give your summary now."
    ),
    "anomaly": (
        "You are a data analyst. Find the single largest EXPENSE transaction from the following list. "
        "Report what the category was, the date, the EXACT TIME, and the amount in 1-2 sentences. "
        "Start directly with 'Your largest single expense this {range} was...'. "
        "Use the user's currency symbol where appropriate. "
        "IMPORTANT: Do not use markdown formatting.\n\n"
        "Transactions:\n{transaction_list_str}\n"
        "Give your finding now."
    ),
    "advice": (
        "You are a friendly financial advisor. A user provided their recent transactions for this {range}. "
        "Analyze them and give one short (under 50 words), simple, actionable piece of advice. "
        "Start directly with the advice. Do not be generic; base it on the provided data. "
        "IMPORTANT: Do not use markdown formatting.\n\n"
        "Transactions:\n{transaction_list_str}\n"
        "Give your advice now."
    ),
}

# Настройка Gemini
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
    model = genai.GenerativeModel("gemini-2.5-flash")
else:
    model = None


# Вспомогательная функция фильтрации
def _get_date_filter_sql(range_str: str, timezone_offset_str: Optional[str]):
    if range_str == "all":
        return "", []

    server_now = datetime.now(timezone.utc)
    offset_minutes = 0
    if timezone_offset_str and timezone_offset_str.lstrip("-").isdigit():
        offset_minutes = int(timezone_offset_str)
        user_now = server_now - timedelta(minutes=offset_minutes)
    else:
        user_now = server_now

    start_date = None
    if range_str == "day":
        start_date = user_now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_str == "week":
        start_date = (user_now - timedelta(days=user_now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_str == "month":
        start_date = user_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif range_str == "year":
        start_date = user_now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    if start_date:
        query_start_utc = (start_date + timedelta(minutes=offset_minutes)).replace(tzinfo=None)
        return " AND t.date >= %s", [query_start_utc]
    return "", []


@router.post("/ai/advice")
async def get_ai_advice(
    range: str = Query("month"),
    prompt_type: str = Query("advice"),
    user=Depends(verify_telegram_authentication),
    db=Depends(get_db),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    if not model:
        raise HTTPException(status_code=503, detail="AI Service unavailable (No API Key)")

    user_id = user["id"]

    # 1. Строим запрос с JOIN
    query = """
        SELECT t.date, t.amount, c.name as category, c.type 
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = %s
    """
    params = [user_id]

    # 2. Добавляем фильтр по дате
    filter_sql, filter_params = _get_date_filter_sql(range, x_timezone_offset)
    query += filter_sql
    params.extend(filter_params)

    query += " ORDER BY t.date DESC LIMIT 50"

    db.execute(query, tuple(params))
    rows = db.fetchall()

    if not rows:
        return {"advice": f"No transactions found for this {range}. Track some expenses first!"}

    # 🔥 ИСПРАВЛЕНО: Оставил только форматирование времени (strftime), дубликат удален
    tx_list_str = "\n".join(
        [f"- {r['date'].strftime('%Y-%m-%d %H:%M')}: {r['type']} {r['amount']} ({r['category']})" for r in rows]
    )

    # 4. Выбираем промпт
    template = PROMPTS.get(prompt_type, PROMPTS["advice"])
    final_prompt = template.format(range=range, transaction_list_str=tx_list_str)

    try:
        response = model.generate_content(final_prompt)
        return {"advice": response.text}
    except Exception as e:
        print(f"AI Generation Error: {e}")
        raise HTTPException(status_code=500, detail="AI is currently busy, try again later.")
