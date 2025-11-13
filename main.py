import psycopg2
from psycopg2.extras import RealDictCursor
import os
import uvicorn
from datetime import datetime, timedelta, timezone # <-- ДОБАВЛЕН timezone
from typing import Optional, List, Tuple, Dict, Any
from collections import defaultdict
from contextlib import contextmanager, asynccontextmanager 
from pathlib import Path

from fastapi import FastAPI, Query, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai

# --- Константы ---
BASE_DIR = Path(__file__).resolve().parent
DB_NAME = BASE_DIR / "finance.db" 
WEBAPP_DIR = BASE_DIR / "webapp"

# --- Загрузка окружения ---
load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL") 

# ---
# --- Управление Базой Данных (Postgres)
# ---

@contextmanager
def get_db_connection():
    """Контекстный менеджер для безопасного соединения с БД Postgres."""
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL не установлен!") 
    
    conn = None 
    
    try:
        conn = psycopg2.connect(DATABASE_URL)
        
        # 🛑 НЕТ "SET TIME ZONE"! База хранит и отдает время в UTC.
        
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
    """Dependency FastAPI для получения соединения с БД."""
    with get_db_connection() as cursor:
        yield cursor

def setup_database():
    """
    Инициализирует базу данных Postgres: создает таблицы.
    """
    try:
        with get_db_connection() as cursor:
            # 🛠️ ФИКС 1: user_id теперь TEXT
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                user_id TEXT, 
                UNIQUE(name, type, user_id)
            )
            """)
            # 🛠️ ФИКС 1: user_id теперь TEXT
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
            
            # --- Заполнение категорий по умолчанию ---
            cursor.execute("SELECT COUNT(*) FROM categories")
            # Проверка 'fetchone()["count"] == 0' здесь должна быть в Postgres,
            # но мы оставим эту логику, чтобы избежать psycopg2.ProgrammingError,
            # если таблицы еще не существуют. (Postgres - регистрозависим, мы исправляем запрос):
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
                # Игнорируем ошибку, если таблицы еще не созданы в транзакции
                pass
    
    except Exception as e:
        print(f"--- [DB Setup ERROR]: Не удалось инициализировать БД: {e}")
        # Не поднимаем ошибку, чтобы Render мог продолжить
        # raise # <-- УБРАЛИ raise, чтобы не сломать Gunicorn

# --- FastAPI Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("--- [Lifespan]: Запуск инициализации БД...")
    # Поскольку 'setup_database' может упасть при первой попытке,
    # мы просто позволяем ему пройти и надеемся, что он починит себя сам.
    try:
        setup_database()
    except Exception as e:
        print(f"--- [Lifespan ERROR]: Не удалось выполнить setup_database: {e}")

    print("--- [Lifespan]: Инициализация БД завершена.")
    yield
    print("--- [Lifespan]: Сервер выключается.")

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
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Модели Pydantic ---
class Transaction(BaseModel):
    user_id: str # <-- ФИКС 2: Строка
    amount: float
    category_id: int
    date: Optional[str] = None

class TransactionUpdate(BaseModel):
    amount: Optional[float] = None
    category_id: Optional[int] = None
    date: Optional[str] = None

class CategoryCreate(BaseModel):
    user_id: str # <-- ФИКС 2: Строка
    name: str
    type: str

# --- API Эндпоинты ---

@app.get("/categories", response_model=List[Dict[str, Any]])
def get_categories(
    user_id: str = Query(...), # <-- Строка
    type: str = Query('expense'),
    cursor = Depends(get_db)
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
    cursor = Depends(get_db)
):
    try:
        cursor.execute(
            "INSERT INTO categories (user_id, name, type) VALUES (%s, %s, %s) RETURNING id",
            (category.user_id, category.name, category.type)
        )
        last_id_row = cursor.fetchone()
        last_id = last_id_row["id"] if last_id_row else None
        
        return {"status": "success", "id": last_id, "name": category.name, "user_id": category.user_id}
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
    user_id: str = Query(...), # <-- Строка
    cursor = Depends(get_db)
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
    user_id: str = Query(...), # <-- Строка
    cursor = Depends(get_db)
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

# 🛠️ ФИКС 3: Универсальное время в ISO формате
def _get_date_for_storage(date_str: str) -> str:
    """
    Проверяет 'YYYY-MM-DD' строку. Если это сегодня, возвращает
    полную метку времени UTC в ISO формате.
    """
    if not date_str:
        raise HTTPException(status_code=400, detail="Date is required.")
    try:
        selected_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        
        if selected_date == datetime.now().date():
            # Возвращаем полный ISO формат, который включает смещение (+00:00)
            return datetime.now(timezone.utc).isoformat()
        
        return date_str
        
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid date format. YYYY-MM-DD expected.")

@app.post("/transactions")
def add_transaction(
    transaction: Transaction,
    cursor = Depends(get_db)
):
    tx_date_str = _get_date_for_storage(transaction.date)
    try:
        query = "INSERT INTO transactions (user_id, amount, category_id, date) VALUES (%s, %s, %s, %s) RETURNING id"
        params = (transaction.user_id, transaction.amount, transaction.category_id, tx_date_str)
        cursor.execute(query, params)
        last_id_row = cursor.fetchone()
        last_id = last_id_row["id"] if last_id_row else None
        return {"status": "success", "id": last_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save transaction: {e}")

@app.get("/transactions", response_model=List[Dict[str, Any]])
def get_transactions(
    user_id: str = Query(...), # <-- Строка
    cursor = Depends(get_db)
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
    user_id: str = Query(...), # <-- Строка
    cursor = Depends(get_db)
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
    user_id: str = Query(...), # <-- Строка
    cursor = Depends(get_db)
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

# ... (Остальные функции без изменений)
def _get_date_range_filter(range_str: str) -> Tuple[str, List[str]]:
    # ...
    # (Остальные функции get_ai_advice, get_analytics_summary, get_analytics_calendar, reset_user_data не меняются,
    # кроме того, что user_id должен быть str)
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
    user_id: str = Query(...), # <-- Строка
    range: str = Query('month'), 
    prompt_type: str = Query('advice'),
    cursor = Depends(get_db)
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
    prompt = PROMPTS.get(prompt_type, PROMPTS['advice'])
        
    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(prompt)
        return {"advice": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get advice from AI: {e}")

@app.get("/analytics/summary")
def get_analytics_summary(
    user_id: str = Query(...), # <-- Строка
    type: str = Query('expense'), 
    range: str = Query('month'),
    cursor = Depends(get_db)
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
    user_id: str = Query(...), # <-- Строка
    month: int = Query(...), 
    year: int = Query(...),
    cursor = Depends(get_db)
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
    user_id: str = Query(...), # <-- Строка
    cursor = Depends(get_db)
):
    try:
        cursor.execute("DELETE FROM transactions WHERE user_id = %s", (user_id,))
        cursor.execute("DELETE FROM categories WHERE user_id = %s", (user_id,))
        return {"status": "success", "message": "All transactions and custom categories have been reset."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred during data reset: {e}")


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
    print("--- [Startup]: Запуск Uvicorn-сервера...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)