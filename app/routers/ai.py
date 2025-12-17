from fastapi import APIRouter, Depends, HTTPException, Header, Query
import google.generativeai as genai
from typing import Optional
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, desc

from app.config import GOOGLE_API_KEY
from app.dependencies import verify_telegram_authentication, get_session
from app.models.sql import TransactionDB, CategoryDB

router = APIRouter(tags=["ai"])

# Промпты для ИИ
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

# Инициализация модели
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
    model = genai.GenerativeModel("gemini-2.5-flash")
else:
    model = None


@router.post("/ai/advice")
async def get_ai_advice(
    range: str = Query("month"),
    prompt_type: str = Query("advice"),
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
    x_timezone_offset: Optional[str] = Header(None, alias="X-Timezone-Offset"),
):
    # 1. Проверяем доступность сервиса
    if not model:
        raise HTTPException(status_code=503, detail="AI Service unavailable (No API Key)")

    user_id = user["id"]

    # 2. Расчет даты начала (с учетом часового пояса пользователя)
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

    # 3. Достаем транзакции из БД
    stmt = (
        select(TransactionDB.date, TransactionDB.amount, CategoryDB.name.label("category"), CategoryDB.type)
        .join(CategoryDB)
        .where(TransactionDB.user_id == user_id)
        .order_by(desc(TransactionDB.date))
        .limit(50)
    )

    if start_date:
        # Приводим локальное начало дня к UTC для сравнения с базой
        query_start_utc = (start_date + timedelta(minutes=offset_minutes)).replace(tzinfo=None)
        stmt = stmt.where(TransactionDB.date >= query_start_utc)

    result = await session.execute(stmt)
    rows = result.mappings().all()

    # Если транзакций нет — не тратим квоту API
    if not rows:
        return {"advice": f"No transactions found for this {range}. Track some expenses first!"}

    # 4. Формируем контекст для ИИ
    tx_list_str = "\n".join(
        [f"- {r['date'].strftime('%Y-%m-%d %H:%M')}: {r['type']} {r['amount']} ({r['category']})" for r in rows]
    )

    template = PROMPTS.get(prompt_type, PROMPTS["advice"])
    final_prompt = template.format(range=range, transaction_list_str=tx_list_str)

    try:
        # 🔥 ИСПРАВЛЕНО: Асинхронный вызов метода (generate_content_async)
        response = await model.generate_content_async(final_prompt)

        # Иногда API возвращает пустой ответ или блокирует контент
        if not response.text:
            raise ValueError("Empty response from AI")

        return {"advice": response.text}

    except Exception as e:
        print(f"AI Generation Error: {e}")
        # Возвращаем 503 Service Unavailable, чтобы фронтенд мог обработать это (например, показать кнопку Retry)
        raise HTTPException(status_code=503, detail="AI is currently busy, try again later.")
