from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Dict, Any
from app.database import get_db
from app.dependencies import verify_telegram_authentication
from app.models.schemas import CategoryCreate

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=List[Dict[str, Any]])
async def get_categories(
    type: str = Query(None), user=Depends(verify_telegram_authentication), db=Depends(get_db)  # expense / income
):
    user_id = user["id"]

    # Выбираем свои категории + дефолтные (где user_id IS NULL)
    query = """
        SELECT id, name, type, user_id 
        FROM categories 
        WHERE (user_id = %s OR user_id IS NULL)
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
        db.execute(
            "INSERT INTO categories (user_id, name, type) VALUES (%s, %s, %s) RETURNING id",
            (user_id, category.name, category.type),
        )
        new_id = db.fetchone()["id"]
        return {"id": new_id, "status": "created"}
    except Exception as e:
        # Обычно это ошибка уникальности (такая категория уже есть)
        print(f"Error adding category: {e}")
        raise HTTPException(status_code=409, detail="Category probably exists")


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: int, user=Depends(verify_telegram_authentication), db=Depends(get_db)):
    user_id = user["id"]

    # 1. Проверяем, что категория принадлежит юзеру (дефолтные удалять нельзя)
    db.execute("SELECT id FROM categories WHERE id = %s AND user_id = %s", (cat_id, user_id))
    if not db.fetchone():
        raise HTTPException(status_code=403, detail="Cannot delete this category (Access denied or Default)")

    # 2. Удаляем (каскадно удалятся и транзакции, если база настроена с ON DELETE CASCADE)
    # Если нет каскада, лучше сначала удалить транзакции:
    db.execute("DELETE FROM transactions WHERE category_id = %s", (cat_id,))
    db.execute("DELETE FROM categories WHERE id = %s", (cat_id,))

    return {"status": "deleted"}


@router.get("/categories/{cat_id}/check")
async def check_category(cat_id: int, user=Depends(verify_telegram_authentication), db=Depends(get_db)):
    user_id = user["id"]
    # Проверяем, есть ли транзакции у этой категории
    db.execute("SELECT COUNT(*) as count FROM transactions WHERE category_id = %s AND user_id = %s", (cat_id, user_id))
    res = db.fetchone()
    return {"transaction_count": res["count"]}
