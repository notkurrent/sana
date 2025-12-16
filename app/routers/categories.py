from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func
from sqlalchemy.dialects.postgresql import insert

from app.dependencies import verify_telegram_authentication, get_session
from app.models.schemas import Category, CategoryCreate
from app.models.sql import CategoryDB, TransactionDB

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=List[Category])
async def get_categories(
    type: str = Query(None), user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]

    # Строим запрос: Ищем категории пользователя (или общие) + Активные
    stmt = select(CategoryDB).where(
        ((CategoryDB.user_id == user_id) | (CategoryDB.user_id.is_(None))) & (CategoryDB.is_active == True)
    )

    if type:
        stmt = stmt.where(CategoryDB.type == type)

    stmt = stmt.order_by(CategoryDB.id.asc())

    result = await session.execute(stmt)
    return result.scalars().all()


@router.post("/categories")
async def add_category(
    category: CategoryCreate, user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]

    # 🔥 CHANGE: "Resurrection Pattern" на SQLAlchemy
    # Используем нативный PostgreSQL функционал INSERT ... ON CONFLICT
    insert_stmt = insert(CategoryDB).values(user_id=user_id, name=category.name, type=category.type, is_active=True)

    # Если конфликт (такая уже была) -> Делаем UPDATE is_active = True
    do_update_stmt = insert_stmt.on_conflict_do_update(
        index_elements=["name", "type", "user_id"], set_=dict(is_active=True)  # Наш Unique Constraint
    ).returning(CategoryDB.id)

    try:
        result = await session.execute(do_update_stmt)
        await session.commit()
        new_id = result.scalar_one()
        return {"id": new_id, "status": "created"}
    except Exception as e:
        await session.rollback()
        print(f"Error adding category: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.delete("/categories/{cat_id}")
async def delete_category(
    cat_id: int, user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]

    # 1. Проверяем существование и права
    stmt = select(CategoryDB).where((CategoryDB.id == cat_id) & (CategoryDB.user_id == user_id))
    result = await session.execute(stmt)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(status_code=403, detail="Cannot delete this category (Access denied or Default)")

    # 🔥 CHANGE: Soft Delete (ORM Style)
    category.is_active = False
    # Нам не нужно делать session.add, так как объект уже отслеживается сессией
    await session.commit()

    return {"status": "deleted"}


@router.get("/categories/{cat_id}/check")
async def check_category_usage(
    cat_id: int, user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]

    # Считаем количество транзакций
    stmt = (
        select(func.count())
        .select_from(TransactionDB)
        .where((TransactionDB.category_id == cat_id) & (TransactionDB.user_id == user_id))
    )
    result = await session.execute(stmt)
    count = result.scalar_one()

    return {"transaction_count": count}
