from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from app.database import get_db
from app.dependencies import verify_telegram_authentication
from app.models.schemas import Category, CategoryCreate

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=List[Category])
async def get_categories(type: str = Query(None), user=Depends(verify_telegram_authentication), db=Depends(get_db)):
    user_id = user["id"]

    # 🔥 CHANGE: Добавили фильтр is_active = TRUE
    # Мы показываем только активные категории
    query = """
        SELECT id, name, type, user_id 
        FROM categories 
        WHERE (user_id = %s OR user_id IS NULL)
          AND is_active = TRUE
    """
    params = [user_id]

    if type:
        query += " AND type = %s"
        params.append(type)

    query += " ORDER BY id ASC"

    db.execute(query, tuple(params))
    return db.fetchall()


@router.post("/categories")
async def add_category(category: CategoryCreate, user=Depends(verify_telegram_authentication), db=Depends(get_db)):
    user_id = user["id"]
    try:
        # 🔥 CHANGE: "Resurrection Pattern" (Воскрешение)
        # Если категория с таким именем уже была (но удалена), мы не создаем новую,
        # а просто ставим старой is_active = TRUE.
        # Это решает проблему дубликатов и ошибок уникальности.

        query = """
            INSERT INTO categories (user_id, name, type, is_active) 
            VALUES (%s, %s, %s, TRUE) 
            ON CONFLICT (name, type, user_id) 
            DO UPDATE SET is_active = TRUE
            RETURNING id
        """

        db.execute(
            query,
            (user_id, category.name, category.type),
        )
        new_id = db.fetchone()["id"]
        return {"id": new_id, "status": "created"}
    except Exception as e:
        print(f"Error adding category: {e}")
        # На всякий случай оставляем обработку, но ON CONFLICT должен решить 99% проблем
        raise HTTPException(status_code=500, detail="Database error")


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: int, user=Depends(verify_telegram_authentication), db=Depends(get_db)):
    user_id = user["id"]

    # 1. Проверяем, что это категория пользователя (системные трогать нельзя)
    db.execute("SELECT id FROM categories WHERE id = %s AND user_id = %s", (cat_id, user_id))
    if not db.fetchone():
        raise HTTPException(status_code=403, detail="Cannot delete this category (Access denied or Default)")

    # 🔥 CHANGE: Soft Delete Logic
    # 1. Мы БОЛЬШЕ НЕ удаляем транзакции. История должна сохраняться!
    # 2. Вместо DELETE делаем UPDATE is_active = FALSE

    db.execute("UPDATE categories SET is_active = FALSE WHERE id = %s", (cat_id,))

    return {"status": "deleted"}


@router.get("/categories/{cat_id}/check")
async def check_category_usage(cat_id: int, user=Depends(verify_telegram_authentication), db=Depends(get_db)):
    """
    Этот эндпоинт теперь носит информационный характер.
    При Soft Delete удалять транзакции не обязательно,
    но предупредить юзера, что у него там есть статистика - хороший тон.
    """
    user_id = user["id"]
    db.execute("SELECT COUNT(*) as count FROM transactions WHERE category_id = %s AND user_id = %s", (cat_id, user_id))
    result = db.fetchone()
    return {"transaction_count": result["count"]}
