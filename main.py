import psycopg2
from psycopg2.extras import RealDictCursor
import os
import uvicorn
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Tuple, Dict, Any
from collections import defaultdict
from contextlib import contextmanager, asynccontextmanager 
from pathlib import Path

# --- ⬇️ ДОБАВЛЕНО ДЛЯ БЕЗОПАСНОСТИ ⬇️ ---
import hmac
import hashlib
import json
import urllib.parse
# --- ⬆️ КОНЕЦ ДОБАВЛЕНИЙ ⬆️ ---

from fastapi import FastAPI, Query, HTTPException, Depends, Request, Header
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

# --- Константы ---
BASE_DIR = Path(__file__).resolve().parent
DB_NAME = BASE_DIR / "finance.db" 
WEBAPP_DIR = BASE_DIR / "webapp"

# --- Загрузка окружения ---
load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL") 
BOT_TOKEN = os.getenv("BOT_TOKEN")
WEB_APP_URL = os.getenv("WEB_APP_URL") 
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL")

# --- Логирование ---
logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
logger = logging.getLogger(__name__)

# ---
# --- Управление Базой Данных (Postgres)
# ---
@contextmanager
def get_db_connection():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL не установлен!") 
    conn = None 
    try:
        conn = psycopg2.connect(DATABASE_URL)
        yield conn.cursor(cursor_factory=RealDictCursor)
    except psycopg2.OperationalError as e:
        print(f"!!! POSTGRES CONNECTION ERROR: {e}")
        raise e
    except Exception as e:
        raise e
    finally:
        if conn:
            conn.commit()
            conn.close()

def get_db():
    with get_db_connection() as cursor:
        yield cursor

def setup_database():
    try:
        with get_db_connection() as cursor:
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                user_id TEXT, 
                UNIQUE(name, type, user_id)
            )
            """)
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL, 
                amount REAL NOT NULL,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                category_id INTEGER NOT NULL, 
                FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
            )
            """)
            cursor.execute("SELECT COUNT(*) FROM categories")
            try:
                cursor.execute("SELECT count(*) FROM categories")
                if cursor.fetchone()["count"] == 0:
                    default_expenses = ['Food', 'Transport', 'Housing', 'Entertainment', 'Other']
                    for cat in default_expenses:
                        cursor.execute("INSERT INTO categories (name, type) VALUES (%s, 'expense')", (cat,))
                    default_incomes = ['Salary', 'Freelance', 'Gifts', 'Other']
                    for cat in default_incomes:
                        cursor.execute("INSERT INTO categories (name, type) VALUES (%s, 'income')", (cat,))
            except psycopg2.ProgrammingError as pe:
                pass
    except Exception as e:
        print(f"--- [DB Setup ERROR]: Не удалось инициализировать БД: {e}")

# ---
# --- Логика Telegram Bot
# ---
if not BOT_TOKEN:
    logger.warning("ВНИМАНИЕ: BOT_TOKEN не найден. Bot-часть не будет инициализирована.")
    ptb_app = None
else:
    try:
        ptb_app = Application.builder().token(BOT_TOKEN).build()
    except Exception as e:
        logger.critical(f"Не удалось инициализировать Telegram Application: {e}")
        ptb_app = None

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user:
        return
    user_name = update.effective_user.first_name
    welcome_text = (
        f"Hello, {user_name}! 🚀\n\n"
        "Welcome to Sana — your personal finance assistant in Telegram."
    )
    if not WEB_APP_URL:
        logger.error("WEB_APP_URL не установлен! Кнопка не будет работать.")
        await update.message.reply_text(f"Hello, {user_name}! Ошибка конфигурации: WEB_APP_URL не найден.")
        return
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo 
    keyboard = [[InlineKeyboardButton("✨ Open Sana", web_app=WebAppInfo(url=WEB_APP_URL))]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(welcome_text, reply_markup=reply_markup)

if ptb_app:
    ptb_app.add_handler(CommandHandler("start", start))
else:
    logger.warning("Обработчик /start НЕ добавлен, так как ptb_app не инициализирован.")

# ---
# --- FastAPI Lifespan
# ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("--- [Lifespan]: Запуск инициализации БД...")
    try:
        setup_database()
        print("--- [Lifespan]: Инициализация БД завершена.")
    except Exception as e:
        print(f"--- [Lifespan ERROR]: Не удалось выполнить setup_database: {e}")

    if ptb_app:
        print("--- [Lifespan]: Инициализация Telegram Bot (Application.initialize)...")
        await ptb_app.initialize() 
        print("--- [Lifespan]: Telegram Bot инициализирован.")
    else:
        logger.warning("--- [Lifespan]: Пропуск инициализации Bot (ptb_app не найден).")
    yield
    if ptb_app:
        print("--- [Lifespan]: Завершение работы Telegram Bot...")
        await ptb_app.shutdown()
    print("--- [Lifespan]: Сервер выключается.")

# ---
# --- 🚀 Инициализация ЕДИНОГО FastAPI App
# ---
app = FastAPI(lifespan=lifespan)

# --- Настройка Gemini ---
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
    print("Google AI SDK настроен.")
else:
    print("ВНИМАНИЕ: GOOGLE_API_KEY не найден.")

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # ❗️ Позже заменишь на свой URL
    allow_methods=["*"],
    # ⬇️ ДОБАВЛЕНО: 'X-Telegram-InitData'
    allow_headers=["*", "X-Telegram-InitData"],
)

# ---
# --- 🚀 БЕЗОПАСНОСТЬ: ВАЛИДАЦИЯ INITDATA (Попытка №2)
# ---

def _validate_hash(init_data: str, bot_token: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Валидирует initData, полученную из заголовка X-Telegram-InitData.
    Возвращает (user_id, None) при успехе или (None, error_message) при неудаче.
    """
    if not bot_token:
        return None, "BOT_TOKEN не сконфигурирован на бэкенде."
        
    try:
        # 1. Парсим строку initData в словарь
        parsed_data = dict(urllib.parse.parse_qsl(init_data))
        
        # 2. Извлекаем хеш, полученный от Telegram
        received_hash = parsed_data.pop('hash', None)
        if received_hash is None:
            return None, "В initData отсутствует поле 'hash'."

        # 3. Проверяем актуальность данных (1 час)
        auth_date_str = parsed_data.get('auth_date', '0')
        auth_date = int(auth_date_str)
        current_time = int(datetime.now(timezone.utc).timestamp())
        
        if (current_time - auth_date) > 3600:
            return None, f"Данные аутентификации устарели (ста_рше 1 часа)."

        # 4. Формируем строку для проверки
        # Собираем все оставшиеся поля (БЕЗ 'hash'), сортируем по ключу
        sorted_pairs = sorted(parsed_data.items(), key=lambda x: x[0])
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted_pairs)

        # 5. Вычисляем наш хеш (Calc:)
        # 5.1. Ключ для HMAC-SHA256
        secret_key = hmac.new("WebAppData".encode(), bot_token.encode(), hashlib.sha256).digest()
        # 5.2. Сам хеш
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

        # 6. Сравниваем хеши
        if calculated_hash != received_hash:
            logger.warning(f"INVALID HASH! Recv: {received_hash} | Calc: {calculated_hash}")
            return None, "Неверный хеш. Запрос не от Telegram."

        # 7. Валидация прошла! Извлекаем user_id
        user_data_str = parsed_data.get('user')
        if not user_data_str:
            return None, "В initData отсутствует поле 'user'."
            
        user_data = json.loads(urllib.parse.unquote(user_data_str))
        user_id = user_data.get('id')
        
        if not user_id:
            return None, "ID пользователя не найден в 'user data'."

        # ❗️ Важно: возвращаем ID как СТРОКУ, т.к. в БД он TEXT
        return str(user_id), None

    except json.JSONDecodeError:
        logger.error("Ошибка JSON-декодирования user data.")
        return None, "Ошибка парсинга 'user data'."
    except Exception as e:
        logger.error(f"Неизвестная ошибка валидации: {e}")
        return None, f"Внутренняя ошибка валидации: {e}"

async def get_validated_user_id(
    x_telegram_initdata: str = Header(...)
) -> str:
    """
    FastAPI Dependency ("Охранник").
    Проверяет заголовок 'X-Telegram-InitData' и возвращает user_id.
    """
    user_id, error = _validate_hash(x_telegram_initdata, BOT_TOKEN)
    
    if error or not user_id:
        # 403 Forbidden - мы поняли запрос, но отказываем в доступе.
        raise HTTPException(
            status_code=403,
            detail=f"Доступ запрещен: {error}"
        )
    
    # logger.info(f"✅ Доступ разрешен для user_id: {user_id}")
    return user_id

# ---
# --- Модели Pydantic (ИЗМЕНЕНЫ)
# ---

class Transaction(BaseModel):
    # 🚫 УБРАЛИ: user_id: str
    amount: float
    category_id: int
    date: Optional[str] = None

class TransactionUpdate(BaseModel):
    amount: Optional[float] = None
    category_id: Optional[int] = None
    date: Optional[str] = None

class CategoryCreate(BaseModel):
    # 🚫 УБРАЛИ: user_id: str
    name: str
    type: str

# ---
# --- API Эндпоинты (ИЗМЕНЕНЫ)
# ---

@app.get("/categories", response_model=List[Dict[str, Any]])
def get_categories(
    type: str = Query('expense'),
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    query = """
    SELECT id, name, user_id 
    FROM categories 
    WHERE type = %s AND (user_id = %s OR user_id IS NULL)
    ORDER BY name
    """
    cursor.execute(query, (type, user_id))
    rows = cursor.fetchall()
    return rows

@app.post("/categories")
def add_category(
    category: CategoryCreate, 
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    try:
        # ✅ ОБНОВЛЕНО: user_id берется из "охранника", а не из category.*
        cursor.execute(
            "INSERT INTO categories (user_id, name, type) VALUES (%s, %s, %s) RETURNING id",
            (user_id, category.name, category.type)
        )
        last_id_row = cursor.fetchone()
        last_id = last_id_row["id"] if last_id_row else None
        
        return {"status": "success", "id": last_id, "name": category.name, "user_id": user_id}
    except psycopg2.Error as e: 
        if e.pgcode == '23505': 
            raise HTTPException(
                status_code=409, 
                detail="Category with this name already exists"
            )
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/categories/{category_id}/check")
def get_category_check(
    category_id: int, 
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    cursor.execute(
        "SELECT id FROM categories WHERE id = %s AND (user_id = %s OR user_id IS NULL)", 
        (category_id, user_id)
    )
    if cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Category not found or access denied")
    
    cursor.execute(
        "SELECT COUNT(*) as count FROM transactions WHERE category_id = %s AND user_id = %s", 
        (category_id, user_id)
    )
    row = cursor.fetchone()
    return {"transaction_count": row["count"]}

@app.delete("/categories/{category_id}")
def delete_category(
    category_id: int, 
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    try:
        cursor.execute("SELECT user_id FROM categories WHERE id = %s AND user_id = %s", (category_id, user_id))
        if cursor.fetchone() is None:
            raise HTTPException(status_code=404, detail="Category not found or access denied. Default categories cannot be deleted.")
        
        cursor.execute(
            "DELETE FROM categories WHERE id = %s AND user_id = %s", 
            (category_id, user_id)
        )
        return {"status": "success", "message": "Category and all associated transactions deleted"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred during deletion: {e}")

def _get_date_for_storage(date_str: str) -> str:
    if not date_str:
        raise HTTPException(status_code=400, detail="Date is required.")
    try:
        selected_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        if selected_date == datetime.now().date():
            return datetime.now(timezone.utc).isoformat()
        return date_str
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid date format. YYYY-MM-DD expected.")

@app.post("/transactions")
def add_transaction(
    transaction: Transaction,
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    tx_date_str = _get_date_for_storage(transaction.date)
    try:
        query = "INSERT INTO transactions (user_id, amount, category_id, date) VALUES (%s, %s, %s, %s) RETURNING id"
        # ✅ ОБНОВЛЕНО: user_id берется из "охранника"
        params = (user_id, transaction.amount, transaction.category_id, tx_date_str)
        cursor.execute(query, params)
        last_id_row = cursor.fetchone()
        last_id = last_id_row["id"] if last_id_row else None
        return {"status": "success", "id": last_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save transaction: {e}")

@app.get("/transactions", response_model=List[Dict[str, Any]])
def get_transactions(
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    query = """
    SELECT 
        t.id, c.type, c.name AS category, t.category_id, t.amount, t.date 
    FROM transactions t 
    JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = %s
    ORDER BY t.date DESC
    """
    cursor.execute(query, (user_id,))
    rows = cursor.fetchall()
    return rows

@app.delete("/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: int, 
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    cursor.execute(
        "DELETE FROM transactions WHERE id = %s AND user_id = %s",
        (transaction_id, user_id)
    )
    rowcount = cursor.rowcount
    if rowcount == 0:
        raise HTTPException(status_code=404, detail="Transaction not found or access denied")
    return {"status": "success", "message": "Transaction deleted"}

@app.patch("/transactions/{transaction_id}")
def update_transaction(
    transaction_id: int, 
    update: TransactionUpdate, 
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    fields_to_update = []
    values = []
    
    if update.amount is not None:
        fields_to_update.append("amount = %s")
        values.append(update.amount)
    if update.category_id is not None:
        fields_to_update.append("category_id = %s")
        values.append(update.category_id)
    if update.date is not None:
        tx_date_str = _get_date_for_storage(update.date)
        fields_to_update.append("date = %s")
        values.append(tx_date_str)

    if not fields_to_update:
        raise HTTPException(status_code=400, detail="No fields to update")

    query = f"UPDATE transactions SET {', '.join(fields_to_update)} WHERE id = %s AND user_id = %s"
    values.extend([transaction_id, user_id])
    
    cursor.execute(query, tuple(values))
    rowcount = cursor.rowcount
    if rowcount == 0:
        raise HTTPException(status_code=404, detail="Transaction not found or access denied")
    
    return {"status": "success", "message": "Transaction updated"}

def _get_date_range_filter(range_str: str) -> Tuple[str, List[str]]:
    if range_str == 'all':
        return "", []
    now = datetime.now()
    start_date_dt = None
    if range_str == 'day':
        start_date_dt = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_str == 'week':
        start_date_dt = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_str == 'month':
        start_date_dt = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif range_str == 'year':
        start_date_dt = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    
    if start_date_dt:
        start_date_str_formatted = start_date_dt.strftime('%Y-%m-%d %H:%M:%S')
        return " AND t.date >= %s", [start_date_str_formatted]
    return "", []

@app.get("/ai-advice")
def get_ai_advice(
    range: str = Query('month'), 
    prompt_type: str = Query('advice'),
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО (Безопасность)
):
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="AI service is not configured.")
    
    query_base = """
    SELECT c.type, c.name AS category, t.amount, t.date 
    FROM transactions t 
    JOIN categories c ON t.category_id = c.id 
    WHERE t.user_id = %s
    """
    params = [user_id]
    
    date_filter_sql, date_params = _get_date_range_filter(range)
    query_base += date_filter_sql
    params.extend(date_params)
    query_base += " ORDER BY t.date DESC"
    
    cursor.execute(query_base, tuple(params))
    rows = cursor.fetchall()

    if len(rows) < 3 and prompt_type != 'summary':
        return {"advice": f"I need at least 3 transactions for this {range} to give you good advice. Keep tracking your finances!"}
    if len(rows) == 0:
         return {"advice": f"You have no transactions for this {range}."}

    transaction_list_str = "\n".join(
        [f"- Date: {row['date']}, Type: {row['type']}, Category: {row['category']}, Amount: {row['amount']}" for row in rows]
    )

    # ---
    # --- ⬇️ ВОТ ВОССТАНОВЛЕННЫЙ БЛОК ⬇️ ---
    # ---
    PROMPTS = {
        'summary': f"""
You are a concise financial analyst. Analyze the following transactions for the period.
Write a very short (2-3 sentences) summary.
Start with the total expenses and total income.
Then, list the top 2-3 EXPENSE categories and their totals.
Use the user's currency symbol where appropriate (e.g., $, ₸, €, etc. if you see it in the amounts). If no symbol is obvious, just use numbers.
Transactions:
{transaction_list_str}
Give your summary now.
""",
        'anomaly': f"""
You are a data analyst. Find the single largest EXPENSE transaction from the following list.
Report what the category was, the date, and the amount in 1-2 sentences.
Start directly with 'Your largest single expense this {range} was...'.
Use the user's currency symbol where appropriate.
Transactions:
{transaction_list_str}
Give your finding now.
""",
        'advice': f"""
You are a friendly financial advisor. A user provided their recent transactions for this {range}.
Analyze them and give one short (under 50 words), simple, actionable piece of advice.
Start directly with the advice. Do not be generic; base it on the provided data.
Transactions:
{transaction_list_str}
Give your advice now.
"""
    }
    # ---
    # --- ⬆️ КОНЕЦ ВОССТАНОВЛЕННОГО БЛОКА ⬆️ ---
    # ---
    
    prompt = PROMPTS.get(prompt_type, PROMPTS['advice'])
        
    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(prompt)
        return {"advice": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get advice from AI: {e}")

@app.get("/analytics/summary")
def get_analytics_summary(
    type: str = Query('expense'), 
    range: str = Query('month'),
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    query_base = """
    SELECT c.name AS category, SUM(t.amount) AS total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = %s AND c.type = %s
    """
    params = [user_id, type]
    
    date_filter_sql, date_params = _get_date_range_filter(range)
    query_base += date_filter_sql
    params.extend(date_params)
    
    query_base += " GROUP BY c.name HAVING SUM(t.amount) > 0 ORDER BY total DESC"
    
    cursor.execute(query_base, tuple(params))
    rows = cursor.fetchall()
    return rows

@app.get("/analytics/calendar")
def get_analytics_calendar(
    month: int = Query(...), 
    year: int = Query(...),
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    month_str = str(month).zfill(2)
    year_str = str(year)

    query_month = """
    SELECT 
        TO_CHAR(t.date, 'YYYY-MM-DD') AS day_key,
        c.type,
        SUM(t.amount) AS daily_total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE 
        t.user_id = %s 
        AND TO_CHAR(t.date, 'YYYY') = %s
        AND TO_CHAR(t.date, 'MM') = %s
    GROUP BY day_key, c.type
    """
    
    cursor.execute(query_month, (user_id, year_str, month_str))
    rows_month = cursor.fetchall()

    month_summary = {"income": 0, "expense": 0, "net": 0}
    days_summary = defaultdict(lambda: {"income": 0, "expense": 0})

    for row in rows_month:
        day_key = row["day_key"]
        amount = row["daily_total"]
        
        if row["type"] == 'income':
            month_summary["income"] += amount
            days_summary[day_key]["income"] += amount
        elif row["type"] == 'expense':
            month_summary["expense"] += amount
            days_summary[day_key]["expense"] += amount
    
    month_summary["net"] = month_summary["income"] - month_summary["expense"]

    return {
        "month_summary": month_summary,
        "days": days_summary
    }

@app.delete("/users/me/reset")
def reset_user_data(
    cursor = Depends(get_db),
    user_id: str = Depends(get_validated_user_id) # ✅ ОБНОВЛЕНО
):
    try:
        cursor.execute("DELETE FROM transactions WHERE user_id = %s", (user_id,))
        cursor.execute("DELETE FROM categories WHERE user_id = %s", (user_id,))
        return {"status": "success", "message": "All transactions and custom categories have been reset."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred during data reset: {e}")


# ---
# --- 🚀 Telegram Webhook Эндпоинты
# ---
if BOT_TOKEN and ptb_app:
    @app.post(f"/{BOT_TOKEN}")
    async def telegram_webhook(request: Request):
        try:
            update_json = await request.json()
            update = Update.de_json(update_json, ptb_app.bot)
            await ptb_app.process_update(update) 
            return {"message": "ok"}
        except Exception as e:
            logger.error(f"Ошибка обработки Webhook: {e}")
            return {"message": "error"}, 500
else:
    logger.warning("Эндпоинт Webhook'а НЕ будет создан (BOT_TOKEN или ptb_app отсутствуют).")


# ---
# --- Статика и SPA
# ---
app.mount("/static", StaticFiles(directory=WEBAPP_DIR), name="static")

@app.get("/{full_path:path}", response_class=HTMLResponse)
def catch_all(full_path: str):
    html_path = WEBAPP_DIR / "index.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    with open(html_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

if __name__ == "__main__":
    print("--- [Startup]: Запуск Uvicorn-сервера (консолидированного)...")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)