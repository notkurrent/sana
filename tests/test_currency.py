from decimal import Decimal

import pytest

from app.services.currency import CurrencyService


@pytest.mark.asyncio
async def test_currency_same_currency_optimization():
    """Should return 1.00 immediately if source and target currencies match."""
    service = CurrencyService()

    rate = await service.get_rate("USD", "USD")

    assert rate == Decimal("1.00")


@pytest.mark.asyncio
async def test_currency_cross_rate_calculation(mocker):
    """
    Validates cross-rate calculation logic.
    Formula: (1 / Rate_From_USD) * Rate_To_USD
    """
    service = CurrencyService()

    # Mock rates: 1 USD = 0.9 EUR, 1 USD = 30.0 TRY
    fake_rates = {"EUR": 0.9, "TRY": 30.0}

    # Bypass cache update
    mocker.patch.object(service, "_rates", fake_rates)

    rate = await service.get_rate("EUR", "TRY")

    # Expected calculation: (1 / 0.9) * 30.0
    expected_rate = (Decimal("1.00") / Decimal("0.9")) * Decimal("30.0")

    assert rate == expected_rate


@pytest.mark.asyncio
async def test_currency_api_failure_fallback(mocker):
    """
    Should return fallback value (1.00) instead of raising exception
    if external API fails.
    """
    service = CurrencyService()
    service._rates = {}  # Simulate empty cache
    # Note: get_rate no longer calls API directly, so we don't need to mock httpx failures.

    rate = await service.get_rate("USD", "EUR")

    # Ensure fail-safe works
    assert rate == Decimal("1.00")
