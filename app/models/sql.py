from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()


class UserDB(Base):
    __tablename__ = "users"

    # Telegram User ID
    id = Column(Text, primary_key=True, index=True)

    base_currency = Column(String(3), default="USD", nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CategoryDB(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, nullable=False)
    type = Column(Text, nullable=False)  # 'income' or 'expense'
    user_id = Column(Text, nullable=True)  # None for system defaults

    # Soft delete flag
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)

    transactions = relationship("TransactionDB", back_populates="category")

    __table_args__ = (UniqueConstraint("name", "type", "user_id", name="uq_category_user"),)


class TransactionDB(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Text, nullable=False)

    # Amount converted to user's base currency (for reports)
    amount = Column(Numeric(10, 2), nullable=False)

    # Actual amount paid in original currency
    original_amount = Column(Numeric(10, 2), nullable=True)

    # Original currency code (e.g., "TRY")
    currency = Column(String(3), default="USD", nullable=False)

    date = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)

    note = Column(Text, nullable=True)

    category = relationship("CategoryDB", back_populates="transactions")
