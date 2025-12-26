import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from app.dependencies import verify_telegram_authentication, get_session
from app.models.schemas import Category, CategoryCreate
from app.models.sql import CategoryDB, TransactionDB

router = APIRouter(tags=["categories"])

# Global lock for default categories initialization
init_lock = asyncio.Lock()

DEFAULT_CATEGORIES = [
    {"name": "Food", "type": "expense"},
    {"name": "Transport", "type": "expense"},
    {"name": "Housing", "type": "expense"},
    {"name": "Other", "type": "expense"},
    {"name": "Salary", "type": "income"},
    {"name": "Freelance", "type": "income"},
    {"name": "Gifts", "type": "income"},
    {"name": "Other", "type": "income"},
]


async def _init_defaults(session: AsyncSession):
    for cat in DEFAULT_CATEGORIES:
        # Check existence to avoid duplicates
        stmt = select(CategoryDB).where(
            (CategoryDB.name == cat["name"]) & (CategoryDB.type == cat["type"]) & (CategoryDB.user_id.is_(None))
        )
        existing = await session.execute(stmt)

        if not existing.scalar_one_or_none():
            stmt = insert(CategoryDB).values(user_id=None, name=cat["name"], type=cat["type"], is_active=True)
            await session.execute(stmt)
    await session.commit()


@router.get("/categories", response_model=List[Category])
async def get_categories(
    type: str = Query(None), user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]

    # Check if system categories exist
    check_stmt = select(CategoryDB.id).where(CategoryDB.user_id.is_(None)).limit(1)
    res = await session.execute(check_stmt)
    has_defaults = res.scalar_one_or_none()

    if not has_defaults:
        async with init_lock:
            # Double-checked locking
            res_retry = await session.execute(check_stmt)
            if not res_retry.scalar_one_or_none():
                await _init_defaults(session)

    stmt = select(CategoryDB).where(
        ((CategoryDB.user_id == user_id) | (CategoryDB.user_id.is_(None))) & (CategoryDB.is_active == True)
    )

    if type:
        stmt = stmt.where(CategoryDB.type == type)

    stmt = stmt.order_by(CategoryDB.user_id.nullsfirst(), CategoryDB.id.asc())

    result = await session.execute(stmt)
    return result.scalars().all()


@router.post("/categories")
async def add_category(
    category: CategoryCreate, user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]

    insert_stmt = insert(CategoryDB).values(user_id=user_id, name=category.name, type=category.type, is_active=True)

    do_update_stmt = insert_stmt.on_conflict_do_update(
        index_elements=["name", "type", "user_id"], set_=dict(is_active=True)
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


@router.patch("/categories/{cat_id}")
async def update_category(
    cat_id: int,
    category_data: CategoryCreate,
    user=Depends(verify_telegram_authentication),
    session: AsyncSession = Depends(get_session),
):
    user_id = user["id"]

    # Allow editing only user-owned categories
    stmt = select(CategoryDB).where((CategoryDB.id == cat_id) & (CategoryDB.user_id == user_id))
    result = await session.execute(stmt)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(status_code=404, detail="Category not found or access denied")

    category.name = category_data.name
    # Changing category type (income/expense) is not allowed to preserve consistency

    await session.commit()
    await session.refresh(category)
    return {"status": "updated", "id": category.id, "name": category.name}


@router.delete("/categories/{cat_id}")
async def delete_category(
    cat_id: int, user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]

    stmt = select(CategoryDB).where((CategoryDB.id == cat_id) & (CategoryDB.user_id == user_id))
    result = await session.execute(stmt)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(status_code=403, detail="Cannot delete this category (Access denied or Default)")

    category.is_active = False
    await session.commit()

    return {"status": "deleted"}


@router.get("/categories/{cat_id}/check")
async def check_category_usage(
    cat_id: int, user=Depends(verify_telegram_authentication), session: AsyncSession = Depends(get_session)
):
    user_id = user["id"]

    stmt = (
        select(func.count())
        .select_from(TransactionDB)
        .where((TransactionDB.category_id == cat_id) & (TransactionDB.user_id == user_id))
    )
    result = await session.execute(stmt)
    count = result.scalar_one()

    return {"transaction_count": count}
