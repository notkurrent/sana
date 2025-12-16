from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import DATABASE_URL

# Создаем асинхронный движок
# Мы добавляем pool_pre_ping=True, чтобы SQLAlchemy проверяла соединение
# перед каждым запросом. Это спасет от "утренних ошибок" Supabase.
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # Поставь True, если хочешь видеть SQL запросы в консоли
    pool_size=5,  # Держим 5 постоянных соединений
    max_overflow=10,  # Если наплыв пользователей - создаем еще 10 временных
    pool_recycle=1800,  # Каждые 30 минут обновляем соединение (чтобы фаервол не убил)
    pool_pre_ping=True,  # 🔥 ГЛАВНАЯ ЗАЩИТА: Пинг базы перед использованием
)

# Фабрика сессий. Именно её мы будем вызывать в dependencies.py
async_session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
