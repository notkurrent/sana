from datetime import datetime, timedelta

import pytest

from app.models.sql import CategoryDB, TransactionDB, UserDB
from app.services.analytics import AnalyticsService


@pytest.fixture
async def analytics_data(session):
    # Setup Data
    user = UserDB(id="1", base_currency="USD")  # User ID in UserDB might be BigInteger? Let's check model.
    # Ah, UserDB usually matches Telegram ID which is BigInt.
    # But wait, the error said "expected str, got int" for argument $4 which is CategoryDB data.
    # Let's check CategoryDB schema.
    session.add(user)

    cat1 = CategoryDB(id=1, user_id="1", name="Salary", type="income")
    cat2 = CategoryDB(id=2, user_id="1", name="Food", type="expense")
    cat3 = CategoryDB(id=3, user_id="1", name="Games", type="expense")
    session.add_all([cat1, cat2, cat3])
    await session.commit()

    # Transactions
    # 1. Income
    t1 = TransactionDB(user_id="1", category_id=1, amount=1000, date=datetime.now())
    # 2. Expense (Food)
    t2 = TransactionDB(user_id="1", category_id=2, amount=300, date=datetime.now())
    # 3. Expense (Games) - with note
    t3 = TransactionDB(user_id="1", category_id=3, amount=50, date=datetime.now(), note="Steam Sale")
    # 4. Old Expense (Last Month)
    old_date = datetime.now() - timedelta(days=40)
    t4 = TransactionDB(user_id="1", category_id=2, amount=999, date=old_date)

    session.add_all([t1, t2, t3, t4])
    await session.commit()
    return user


@pytest.mark.asyncio
async def test_get_aggregated_summary(session, analytics_data):
    service = AnalyticsService(session)

    # Test Current Month (should exclude t4)
    start_date = datetime.now() - timedelta(days=30)
    summary = await service.get_aggregated_summary(user_id="1", start_date=start_date)

    # Assertions
    assert summary["income"] == 1000.0
    assert summary["expense"] == 350.0  # 300 + 50
    assert len(summary["categories"]) == 3

    # Check category breakdown
    food_cat = next(c for c in summary["categories"] if c["name"] == "Food")
    assert food_cat["total"] == 300.0


@pytest.mark.asyncio
async def test_summary_all_time(session, analytics_data):
    service = AnalyticsService(session)
    # Test All Time (should include t4)
    start_date = datetime.min
    summary = await service.get_aggregated_summary(user_id="1", start_date=start_date)

    assert summary["expense"] == 1349.0  # 300 + 50 + 999


@pytest.mark.asyncio
async def test_top_transactions(session, analytics_data):
    service = AnalyticsService(session)
    start_date = datetime.now() - timedelta(days=30)

    txs = await service.get_significant_transactions(user_id="1", start_date=start_date, limit=5)

    # Only expenses are returned by default design of significant_transactions?
    # Let's check the code: yes, `CategoryDB.type == "expense"`.
    assert len(txs) == 2  # Only t2 (Food) and t3 (Games). Output exclude Income and Old expense.

    # Verify Sorting (Amount Descending)
    assert txs[0]["amount"] == 300
    assert txs[1]["amount"] == 50
    assert txs[1]["note"] == "Steam Sale"


@pytest.mark.asyncio
async def test_empty_data(session):
    service = AnalyticsService(session)
    # No data inserted
    summary = await service.get_aggregated_summary(user_id="999", start_date=datetime.min)

    assert summary["income"] == 0.0
    assert summary["expense"] == 0.0
    assert summary["categories"] == []

    txs = await service.get_significant_transactions(user_id="999", start_date=datetime.min)
    assert txs == []
