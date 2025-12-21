from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()


# 🔥 НОВАЯ ТАБЛИЦА: Храним настройки пользователя
class UserDB(Base):
    __tablename__ = "users"

    # Telegram User ID (используем Text, так как ID может быть длинным)
    id = Column(Text, primary_key=True, index=True)

    # Базовая валюта пользователя (по умолчанию USD)
    base_currency = Column(String(3), default="USD", nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CategoryDB(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, nullable=False)
    type = Column(Text, nullable=False)  # 'income' or 'expense'
    user_id = Column(Text, nullable=True)  # None для дефолтных

    # is_active нужен для Soft Delete (архивирование вместо удаления)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)

    # Связь с транзакциями
    transactions = relationship("TransactionDB", back_populates="category")

    __table_args__ = (UniqueConstraint("name", "type", "user_id", name="uq_category_user"),)


class TransactionDB(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Text, nullable=False)

    # amount - сумма пересчитанная в БАЗОВУЮ валюту пользователя (для графиков)
    amount = Column(Numeric(10, 2), nullable=False)

    # original_amount - сколько реально заплатил (оригинал траты)
    original_amount = Column(Numeric(10, 2), nullable=True)

    # currency - код валюты оригинала (например "TRY")
    currency = Column(String(3), default="USD", nullable=False)

    # timezone=True важно для корректного времени сервера
    date = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)

    note = Column(Text, nullable=True)

    # Связь с категорией
    category = relationship("CategoryDB", back_populates="transactions")
