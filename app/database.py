import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from app.config import DATABASE_URL

# Глобальный пул соединений
db_pool = None


def init_db_pool():
    """Инициализация пула и создание таблиц"""
    global db_pool
    print("--- [DB]: Connecting to database...")
    try:
        db_pool = psycopg2.pool.SimpleConnectionPool(minconn=1, maxconn=20, dsn=DATABASE_URL)
        if db_pool:
            print("--- [DB]: Connection pool created successfully!")
            create_tables()  # <--- ВАЖНО: Создаем таблицы при старте
    except Exception as e:
        print(f"--- [DB ERROR]: Could not connect to DB: {e}")
        raise e


def create_tables():
    """Создание структуры БД (как было в старом main.py)"""
    print("--- [DB]: Checking tables...")
    try:
        with get_db_connection() as cursor:
            # Таблица категорий
            cursor.execute(
                """
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                user_id TEXT, 
                UNIQUE(name, type, user_id)
            )
            """
            )
            # Таблица транзакций
            cursor.execute(
                """
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL, 
                amount REAL NOT NULL,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                category_id INTEGER NOT NULL, 
                FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
            )
            """
            )

            # Дефолтные категории
            cursor.execute("SELECT COUNT(*) as count FROM categories")
            if cursor.fetchone()["count"] == 0:
                print("--- [DB]: Seeding default categories...")
                default_expenses = ["Food", "Transport", "Housing", "Other"]
                for cat in default_expenses:
                    cursor.execute("INSERT INTO categories (name, type) VALUES (%s, 'expense')", (cat,))
                default_incomes = ["Salary", "Freelance", "Gifts", "Other"]
                for cat in default_incomes:
                    cursor.execute("INSERT INTO categories (name, type) VALUES (%s, 'income')", (cat,))
    except Exception as e:
        print(f"--- [DB Setup ERROR]: {e}")


def close_db_pool():
    global db_pool
    if db_pool:
        db_pool.closeall()
        print("--- [DB]: Pool closed.")


@contextmanager
def get_db_connection():
    if not db_pool:
        raise ValueError("DB Pool not initialized. Call init_db_pool() first.")

    conn = None
    try:
        conn = db_pool.getconn()

        # HEALTH CHECK
        try:
            if conn.closed:
                raise psycopg2.InterfaceError
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        except (psycopg2.InterfaceError, psycopg2.OperationalError):
            try:
                db_pool.putconn(conn, close=True)
            except:
                pass
            conn = db_pool.getconn()

        yield conn.cursor(cursor_factory=RealDictCursor)
        conn.commit()
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except:
                pass
        raise e
    finally:
        if conn:
            try:
                db_pool.putconn(conn)
            except:
                pass


def get_db():
    with get_db_connection() as cursor:
        yield cursor
