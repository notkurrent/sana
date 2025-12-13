from pydantic import BaseModel
from typing import Optional, Union
from datetime import datetime


# --- Модели для Категорий ---
class CategoryCreate(BaseModel):
    name: str
    type: str  # 'expense' или 'income'


class Category(CategoryCreate):
    id: int
    user_id: Optional[str] = None  # Может быть None для дефолтных категорий

    class Config:
        from_attributes = True


# --- Модели для Транзакций ---
class TransactionCreate(BaseModel):
    amount: float
    category_id: int
    # Разрешаем и строку (от фронта), и datetime (на всякий случай)
    date: Union[str, datetime]


# 🔥 ДОБАВЛЕНО: Модель для редактирования
class TransactionUpdate(BaseModel):
    amount: Optional[float] = None
    category_id: Optional[int] = None
    date: Optional[Union[str, datetime]] = None


class Transaction(BaseModel):
    id: int
    amount: float
    category: str  # Имя категории (получаем через JOIN)
    type: str  # Тип категории (expense/income)

    # Pydantic сам конвертирует datetime из БД в ISO-строку для JSON
    date: datetime

    category_id: int

    class Config:
        from_attributes = True
