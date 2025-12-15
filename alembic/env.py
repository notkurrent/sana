import sys
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# --- 🔥 НАШИ ИЗМЕНЕНИЯ НАЧИНАЮТСЯ ЗДЕСЬ ---

# 1. Добавляем путь к корню проекта, чтобы Python видел папку app/
sys.path.append(os.getcwd())

# 2. Импортируем наши настройки и модели
from app.config import DATABASE_URL
from app.models.sql import Base  # Наша "Теневая модель"

# 3. Подменяем URL базы данных на тот, что в конфиге (из .env)
# Alembic по умолчанию ищет его в alembic.ini, но мы берем из кода для безопасности
config = context.config
config.set_main_option("sqlalchemy.url", DATABASE_URL)

# 4. Указываем метаданные моделей для авто-генерации миграций
target_metadata = Base.metadata

# --- КОНЕЦ НАШИХ ИЗМЕНЕНИЙ ---

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    # Создаем движок подключения
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
