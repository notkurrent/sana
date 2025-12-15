# app/models/sql.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


class CategoryDB(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, nullable=False)
    type = Column(Text, nullable=False)  # 'income' or 'expense'
    user_id = Column(Text, nullable=True)  # None для дефолтных

    # 🔥 ВАЖНО: То самое поле, ради которого мы все это затеяли
    # Пока ставим server_default="true", чтобы старые записи не скрылись
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)

    __table_args__ = (UniqueConstraint("name", "type", "user_id", name="uq_category_user"),)


class TransactionDB(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Text, nullable=False)
    amount = Column(Float, nullable=False)
    date = Column(DateTime(timezone=False), server_default=func.now())

    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
