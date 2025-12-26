from pydantic import BaseModel
from typing import Optional, Union
from datetime import datetime
from decimal import Decimal


# --- Category Models ---
class CategoryCreate(BaseModel):
    name: str
    type: str  # 'expense' or 'income'


class Category(CategoryCreate):
    id: int
    user_id: Optional[str] = None

    class Config:
        from_attributes = True


# --- Transaction Models ---
class TransactionCreate(BaseModel):
    amount: Decimal
    currency: str = "USD"
    category_id: int
    date: Union[str, datetime]
    note: Optional[str] = None


class TransactionUpdate(BaseModel):
    amount: Optional[Decimal] = None
    currency: Optional[str] = None
    category_id: Optional[int] = None
    date: Optional[Union[str, datetime]] = None
    note: Optional[str] = None


class Transaction(BaseModel):
    id: int
    amount: Decimal
    original_amount: Optional[Decimal] = None
    currency: str

    category: str
    type: str
    date: datetime
    category_id: int
    note: Optional[str] = None

    class Config:
        from_attributes = True
