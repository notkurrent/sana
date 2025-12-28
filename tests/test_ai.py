from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from app.dependencies import verify_telegram_authentication
from app.models.sql import CategoryDB, TransactionDB, UserDB
from main import app

# Headers for auth (simulated)
AUTH_HEADERS = {
    "X-Telegram-Init-Data": "query_id=AAHdF60UAAAAAN0XrRT9&user=%7B%22id%22%3A1%2C%22first_name%22%3A%22TestUser%22%2C%22username%22%3A%22testuser%22%2C%22language_code%22%3A%22en%22%7D&auth_date=1710000000&hash=mocked_hash_bypass"  # noqa: E501
}


@pytest.fixture
def mock_user_auth():
    # Helper to force successfully auth
    app.dependency_overrides[verify_telegram_authentication] = lambda: {"id": "1", "first_name": "TestUser"}
    yield
    app.dependency_overrides.pop(verify_telegram_authentication, None)


@pytest.mark.asyncio
async def test_ai_advice_success_empty(client, session, mock_user_auth):
    # 2. Mock AI Model
    with patch("app.routers.ai.model") as mock_model:
        mock_chat = AsyncMock()
        mock_chat.generate_content_async.return_value.text = "Track your expenses."
        mock_model.generate_content_async = mock_chat.generate_content_async

        # 3. Request
        response = await client.post("/api/ai/advice?range=month", headers={})

        assert response.status_code == 200
        data = response.json()
        assert "advice" in data
        assert "No transactions found" in data["advice"]


@pytest.mark.asyncio
async def test_ai_advice_with_data(client, session, mock_user_auth):
    # Setup Data manually for this test
    user = UserDB(id="1", base_currency="USD")
    session.add(user)
    cat = CategoryDB(id=1, user_id="1", name="Food", type="expense")
    session.add(cat)
    await session.commit()
    tx = TransactionDB(user_id="1", category_id=1, amount=100, date=datetime.now())
    session.add(tx)
    await session.commit()

    with patch("app.routers.ai.model") as mock_model:
        mock_chat = AsyncMock()
        mock_chat.generate_content_async.return_value.text = "Stop eating out."
        mock_model.generate_content_async = mock_chat.generate_content_async

        response = await client.post("/api/ai/advice?range=month", headers={})

        assert response.status_code == 200
        data = response.json()
        assert data["advice"] == "Stop eating out."
        # Verify that generate_content_async was called (meaning we passed the 'no data' check)
        mock_model.generate_content_async.assert_called_once()
        # Verify prompt contained currency (USD)
        call_args = mock_model.generate_content_async.call_args[0][0]
        assert "USD" in call_args


@pytest.mark.asyncio
async def test_ai_error_handling(client, mock_user_auth):
    # Simulate AI Exception
    with patch("app.routers.ai.model") as mock_model:
        # Mock analytics service to return SOME data so we pass the "No transactions" check
        with patch("app.services.analytics.AnalyticsService.get_aggregated_summary") as mock_agg:
            mock_agg.return_value = {"income": 100, "expense": 50, "categories": []}

            with patch("app.services.analytics.AnalyticsService.get_significant_transactions") as mock_sig:
                mock_sig.return_value = []

                # Now model raises error
                mock_model.generate_content_async.side_effect = Exception("Google Down")

                response = await client.post("/api/ai/advice", headers={})

                assert response.status_code == 503
                assert "AI is currently busy" in response.json()["detail"]
