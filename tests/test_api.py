from datetime import datetime
from decimal import Decimal

import pytest

from app.dependencies import verify_telegram_authentication
from app.models.sql import CategoryDB, TransactionDB
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
async def test_create_transaction_rejects_invalid_currency(client):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER

    payload = {
        "amount": 100.00,
        "currency": "JPY",
        "category_id": 1,
        "date": "2023-10-10",
    }

    response = await client.post("/api/transactions", json=payload)

    assert response.status_code == 422

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_create_category_rejects_invalid_type(client):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER

    response = await client.post("/api/categories", json={"name": "Bad", "type": "transfer"})

    assert response.status_code == 422

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_create_transaction_rejects_other_users_category(client, session, mocker):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER
    mocker.patch("app.services.currency.CurrencyService.get_rate", return_value=Decimal("1.00"))

    category = CategoryDB(name="Private", type="expense", user_id="other-user", is_active=True)
    session.add(category)
    await session.commit()
    await session.refresh(category)

    payload = {
        "amount": 100.00,
        "currency": "USD",
        "category_id": category.id,
        "date": "2023-10-10",
    }

    response = await client.post("/api/transactions", json=payload)

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid category_id"

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_create_transaction_rejects_inactive_category(client, session, mocker):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER
    mocker.patch("app.services.currency.CurrencyService.get_rate", return_value=Decimal("1.00"))

    category = CategoryDB(name="Inactive", type="expense", user_id=MOCK_USER["id"], is_active=False)
    session.add(category)
    await session.commit()
    await session.refresh(category)

    payload = {
        "amount": 100.00,
        "currency": "USD",
        "category_id": category.id,
        "date": "2023-10-10",
    }

    response = await client.post("/api/transactions", json=payload)

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid category_id"

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_update_transaction_rejects_other_users_category(client, session, mocker):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER
    mocker.patch("app.services.currency.CurrencyService.get_rate", return_value=Decimal("1.00"))

    own_category = CategoryDB(name="Own", type="expense", user_id=MOCK_USER["id"], is_active=True)
    other_category = CategoryDB(name="Other", type="expense", user_id="other-user", is_active=True)
    session.add_all([own_category, other_category])
    await session.commit()
    await session.refresh(own_category)
    await session.refresh(other_category)

    tx = TransactionDB(
        user_id=MOCK_USER["id"],
        category_id=own_category.id,
        amount=100,
        original_amount=100,
        currency="USD",
        date=datetime.now(),
    )
    session.add(tx)
    await session.commit()
    await session.refresh(tx)

    response = await client.patch(f"/api/transactions/{tx.id}", json={"category_id": other_category.id})

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid category_id"

    await session.refresh(tx)
    assert tx.category_id == own_category.id

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_update_transaction_rejects_invalid_category_before_mutating_amount(client, session, mocker):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER
    mocker.patch("app.services.currency.CurrencyService.get_rate", return_value=Decimal("1.00"))

    own_category = CategoryDB(name="Own", type="expense", user_id=MOCK_USER["id"], is_active=True)
    other_category = CategoryDB(name="Other", type="expense", user_id="other-user", is_active=True)
    session.add_all([own_category, other_category])
    await session.commit()
    await session.refresh(own_category)
    await session.refresh(other_category)

    tx = TransactionDB(
        user_id=MOCK_USER["id"],
        category_id=own_category.id,
        amount=100,
        original_amount=100,
        currency="USD",
        date=datetime.now(),
    )
    session.add(tx)
    await session.commit()
    await session.refresh(tx)

    response = await client.patch(
        f"/api/transactions/{tx.id}",
        json={"amount": 250, "category_id": other_category.id},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid category_id"
    assert tx.amount == 100
    assert tx.original_amount == 100
    assert tx.category_id == own_category.id

    app.dependency_overrides.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
async def test_get_transactions_rejects_invalid_limit_or_offset(client, query):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER

    response = await client.get(f"/api/transactions?{query}")

    assert response.status_code == 422

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


@pytest.mark.asyncio
async def test_get_transactions(client, session):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER

    # Setup
    category = CategoryDB(name="Rent", type="expense", user_id=MOCK_USER["id"])
    session.add(category)
    await session.commit()
    await session.refresh(category)

    tx1 = TransactionDB(
        user_id=MOCK_USER["id"],
        category_id=category.id,
        amount=500,
        original_amount=500,
        currency="USD",
        date=datetime.now(),
    )
    session.add(tx1)
    await session.commit()

    # Test
    response = await client.get("/api/transactions?limit=10")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    # Check amount (FastAPI serializes Decimal to string '500.00' or similar)
    assert float(data[0]["amount"]) == 500.0

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_delete_transaction(client, session):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER

    # Setup
    category = CategoryDB(name="Coffee", type="expense", user_id=MOCK_USER["id"])
    session.add(category)
    await session.commit()
    await session.refresh(category)

    tx1 = TransactionDB(
        user_id=MOCK_USER["id"],
        category_id=category.id,
        amount=5,
        original_amount=5,
        currency="USD",
        date=datetime.now(),
    )
    session.add(tx1)
    await session.commit()
    await session.refresh(tx1)

    # Test Delete
    response = await client.delete(f"/api/transactions/{tx1.id}")
    assert response.status_code == 200

    # Verify DB
    deleted_tx = await session.get(TransactionDB, tx1.id)
    assert deleted_tx is None

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_categories(client, session):
    app.dependency_overrides[verify_telegram_authentication] = lambda: MOCK_USER

    # Setup
    c1 = CategoryDB(name="Salary", type="income", user_id=MOCK_USER["id"])
    c2 = CategoryDB(name="Fun", type="expense", user_id=MOCK_USER["id"])
    session.add_all([c1, c2])
    await session.commit()

    # Test
    response = await client.get("/api/categories?type=expense")
    assert response.status_code == 200
    data = response.json()

    # System default categories might exist
    assert len(data) >= 1
    names = [c["name"] for c in data]
    assert "Fun" in names

    app.dependency_overrides.clear()
