from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

SUPPORTED_CURRENCIES = Literal["USD", "TRY", "KZT", "RUB", "EUR", "GBP", "UAH"]


# --- Category Models ---
class CategoryCreate(BaseModel):
    name: str
    type: Literal["income", "expense"]


class Category(CategoryCreate):
    id: int
    user_id: str | None = None

    class Config:
        from_attributes = True


# --- Transaction Models ---
class TransactionCreate(BaseModel):
    amount: Decimal
    currency: SUPPORTED_CURRENCIES = "USD"
    category_id: int
    date: str | datetime
    note: str | None = None


class TransactionUpdate(BaseModel):
    amount: Decimal | None = None
    currency: SUPPORTED_CURRENCIES | None = None
    category_id: int | None = None
    date: str | datetime | None = None
    note: str | None = None


class Transaction(BaseModel):
    id: int
    amount: Decimal
    original_amount: Decimal | None = None
    currency: str

    category: str
    type: str
    date: datetime
    category_id: int
    note: str | None = None

    class Config:
        from_attributes = True
