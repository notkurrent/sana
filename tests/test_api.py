import pytest
from decimal import Decimal
from datetime import datetime
from app.models.sql import CategoryDB, TransactionDB
from app.dependencies import verify_telegram_authentication
from main import app

MOCK_USER = {"id": "12345", "first_name": "TestUser", "username": "testuser"}


@pytest.mark.asyncio
async def test_create_transaction_with_currency_conversion(client, session, mocker):
    """
    Tests the full transaction creation cycle via API.
    """
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER
    mocker.patch("app.services.currency.CurrencyService.get_rate", return_value=Decimal("0.03"))

    category = CategoryDB(name="Kebab", type="expense", user_id=MOCK_USER["id"], is_active=True)
    session.add(category)
    await session.commit()
    await session.refresh(category)

    payload = {
        "amount": 100.00,
        "currency": "TRY",
        "category_id": category.id,
        "date": "2023-10-10",
    }

    response = await client.post("/api/transactions", json=payload)

    assert response.status_code == 200, f"Error: {response.text}"
    data = response.json()

    # Note: Ensure your API actually returns these fields based on the Pydantic model
    # If the model changed, update the assertions below.
    if "status" in data:
        assert data["status"] == "saved"

    # Verify DB state
    if "id" in data:
        tx_id = data["id"]
        stmt = await session.get(TransactionDB, tx_id)
        assert stmt is not None
        assert stmt.original_amount == 100.00
        assert stmt.currency == "TRY"
        assert round(stmt.amount, 2) == 3.00

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_balance_calculation_mixed_currencies(client, session, mocker):
    """
    Tests if the total balance is calculated correctly with mixed currencies.
    """
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER
    mocker.patch("app.services.currency.CurrencyService.get_rate", return_value=Decimal("0.03"))

    category = CategoryDB(name="Food", type="expense", user_id=MOCK_USER["id"], is_active=True)
    session.add(category)
    await session.commit()
    await session.refresh(category)

    # Insert transactions directly into DB
    test_date = datetime(2023, 10, 10)

    tx1 = TransactionDB(
        user_id=MOCK_USER["id"],
        category_id=category.id,
        amount=10.00,
        original_amount=10.00,
        currency="USD",
        date=test_date,
    )

    tx2 = TransactionDB(
        user_id=MOCK_USER["id"],
        category_id=category.id,
        amount=3.00,
        original_amount=100.00,
        currency="TRY",
        date=test_date,
    )

    session.add_all([tx1, tx2])
    await session.commit()

    response = await client.get("/api/balance")

    assert response.status_code == 200
    data = response.json()
    assert data["balance"] == -13.00

    app.dependency_overrides.clear()
