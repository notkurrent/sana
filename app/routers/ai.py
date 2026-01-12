from datetime import UTC, datetime, timedelta

import google.generativeai as genai
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import GOOGLE_API_KEY
from app.dependencies import get_session, verify_telegram_authentication
from app.models.sql import UserDB
from app.services.analytics import AnalyticsService

router = APIRouter(tags=["ai"])

PROMPTS = {
    "advice": (
        "Analyze the user's monthly data. "
        "DATA: STATS (Total income/expense) and DETAILS (Top expenses).\n"
        "{data_block}\n\n"
        "TASK: Give one short, actionable piece of advice (max 2 sentences). "
        "Focus on the largest spending category or a specific concerning transaction note. "
        "Use the currency {currency} for all amounts. "
        "IMPORTANT: NO greetings (no 'Hello'), NO filler words. Direct start."
    ),
    "summary": (
        "Summarize this period in 2 short sentences.\n"
        "{data_block}\n"
        "Mention total income/expense and the top category. Use {currency}. "
        "NO greetings."
    ),
    "anomaly": (
        "Find the single largest/most unusual expense.\n"
        "{data_block}\n"
        "State what it is and why it stands out. Use {currency}. 1 sentence only."
    ),
}

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
    x_timezone_offset: str | None = Header(None, alias="X-Timezone-Offset"),
):
    if not model:
        raise HTTPException(status_code=503, detail="AI Service unavailable (No API Key)")

    user_id = user["id"]
    analytics_service = AnalyticsService(session)

    # Fetch User Currency
    user_result = await session.execute(select(UserDB).where(UserDB.id == user_id))
    user_db = user_result.scalar_one_or_none()
    currency = user_db.base_currency if user_db else "USD"

    # Date Calculation
    server_now = datetime.now(UTC)
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

    # 1. Get Aggregated Stats
    # We need to pass UTC start date to the service
    query_start_utc = (
        (start_date + timedelta(minutes=offset_minutes)).replace(tzinfo=None) if start_date else datetime.min
    )

    summary = await analytics_service.get_aggregated_summary(user_id, query_start_utc)

    # 2. Get Top Transactions
    top_txs = await analytics_service.get_significant_transactions(user_id, query_start_utc, limit=20)

    if summary["income"] == 0 and summary["expense"] == 0:
        return {"advice": f"No transactions found for this {range}. Track some expenses first!"}

    # 3. Format Prompt
    stats_str = f"STATS:\n- Income: {summary['income']:.2f} {currency}\n- Expense: {summary['expense']:.2f} {currency}\n- Categories:\n"  # noqa: E501
    for cat in summary["categories"][:5]:  # Top 5 categories
        stats_str += f"  * {cat['name']} ({cat['type']}): {cat['total']:.2f} {currency}\n"

    details_str = "DETAILS (Top Expenses):\n"
    for tx in top_txs:
        note_str = f' - Note: "{tx["note"]}"' if tx["note"] else ""

        amount_str = f"{tx['amount']} {tx['currency']}"
        if tx["currency"] != currency and tx.get("original_amount"):
            amount_str = f"{tx['original_amount']} {tx['currency']} (~{tx['amount']} {currency})"

        details_str += f"- {tx['date'].strftime('%d %b')}: {amount_str} ({tx['category']}){note_str}\n"

    full_data_block = f"{stats_str}\n{details_str}"

    template = PROMPTS.get(prompt_type, PROMPTS["advice"])
    final_prompt = template.format(data_block=full_data_block, currency=currency)

    try:
        response = await model.generate_content_async(final_prompt)
        if not response.text:
            raise ValueError("Empty response")
        return {"advice": response.text}

    except Exception as e:
        import traceback

        print(f"AI Generation Error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=503, detail="AI is currently busy") from e
