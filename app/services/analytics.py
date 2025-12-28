from datetime import datetime

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sql import CategoryDB, TransactionDB


class AnalyticsService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_aggregated_summary(self, user_id: int, start_date: datetime):
        """
        Returns total income/expense and a breakdown by category.
        """
        stmt = (
            select(CategoryDB.name, CategoryDB.type, func.sum(TransactionDB.amount).label("total"))
            .join(CategoryDB, TransactionDB.category_id == CategoryDB.id)
            .where(TransactionDB.user_id == user_id, TransactionDB.date >= start_date)
            .group_by(CategoryDB.name, CategoryDB.type)
            .order_by(desc("total"))
        )

        result = await self.session.execute(stmt)
        rows = result.fetchall()

        summary = {"income": 0.0, "expense": 0.0, "categories": []}

        for name, type_, total in rows:
            val = float(total or 0)
            if type_ == "income":
                summary["income"] += val
            else:
                summary["expense"] += val

            summary["categories"].append({"name": name, "type": type_, "total": val})

        return summary

    async def get_significant_transactions(self, user_id: int, start_date: datetime, limit: int = 20):
        """
        Fetches largest transactions, prioritizing those with notes.
        """
        # Improved sorting:
        # 1. Transactions with notes usually have more context, so we might want to prioritize them?
        # For now, let's strictly sort by amount (descending) to capture "heavy" spending.
        # But we ensure we fetch the note field.

        stmt = (
            select(
                TransactionDB.date,
                TransactionDB.amount,
                TransactionDB.currency,
                TransactionDB.note,
                CategoryDB.name.label("category"),
                CategoryDB.type,
            )
            .join(CategoryDB, TransactionDB.category_id == CategoryDB.id)
            .where(
                TransactionDB.user_id == user_id,
                TransactionDB.date >= start_date,
                CategoryDB.type == "expense",  # Usually we analyze expenses for advice
            )
            .order_by(desc(TransactionDB.amount))
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        return result.mappings().all()
