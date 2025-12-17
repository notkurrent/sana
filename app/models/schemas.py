from pydantic import BaseModel
from typing import Optional, Union
from datetime import datetime
from decimal import Decimal


# --- Модели для Категорий ---
class CategoryCreate(BaseModel):
    name: str
    type: str  # 'expense' или 'income'


class Category(CategoryCreate):
    id: int
    user_id: Optional[str] = None

    class Config:
        from_attributes = True


# --- Модели для Транзакций ---
class TransactionCreate(BaseModel):
    amount: Decimal  # 🔥 Decimal для точности
    currency: str = "USD"  # 🔥 Код валюты (по умолчанию USD)
    category_id: int
    date: Union[str, datetime]


class TransactionUpdate(BaseModel):
    amount: Optional[Decimal] = None
    currency: Optional[str] = None
    category_id: Optional[int] = None
    date: Optional[Union[str, datetime]] = None


class Transaction(BaseModel):
    id: int
    amount: Decimal
    original_amount: Optional[Decimal] = None  # 🔥 Сколько реально потрачено
    currency: str  # 🔥 Валюта траты

    category: str
    type: str
    date: datetime
    category_id: int

    class Config:
        from_attributes = True
