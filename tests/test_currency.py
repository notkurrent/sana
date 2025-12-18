import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from app.services.currency import CurrencyService


# Этот декоратор помечает тест как асинхронный
@pytest.mark.asyncio
async def test_currency_same_currency_optimization():
    """Если валюты совпадают, API не дергаем, возвращаем 1.0"""
    service = CurrencyService()

    # Вызываем конвертацию USD -> USD
    rate = await service.get_rate("USD", "USD")

    assert rate == Decimal("1.00")


@pytest.mark.asyncio
async def test_currency_cross_rate_calculation(mocker):
    """
    Проверяем математику кросс-курса (EUR -> TRY).
    Логика: (1 / Rate_EUR) * Rate_TRY
    """
    service = CurrencyService()

    # 1. ПОДГОТОВКА (Arrange)
    # Имитируем кэш курсов, чтобы не лезть в интернет
    # Представим, что: 1 USD = 0.9 EUR, 1 USD = 30.0 TRY
    fake_rates = {"EUR": 0.9, "TRY": 30.0}

    # "Мокаем" (подменяем) внутренний словарь _rates и метод проверки кэша
    mocker.patch.object(service, "_rates", fake_rates)
    mocker.patch.object(service, "_is_cache_expired", return_value=False)

    # 2. ДЕЙСТВИЕ (Act)
    # Конвертируем EUR в TRY
    rate = await service.get_rate("EUR", "TRY")

    # 3. ПРОВЕРКА (Assert)
    # Ожидаем: (1 / 0.9) * 30.0 = 33.333...
    expected_rate = (Decimal("1.00") / Decimal("0.9")) * Decimal("30.0")

    assert rate == expected_rate


@pytest.mark.asyncio
async def test_currency_api_failure_fallback(mocker):
    """
    Если API недоступен (ошибка сети), сервис должен вернуть 1.00
    и не положить всё приложение.
    """
    service = CurrencyService()

    # Очищаем кэш, чтобы спровоцировать запрос к API
    service._rates = {}

    # "Мокаем" httpx клиент, чтобы он выбросил ошибку при попытке GET запроса
    mocker.patch("httpx.AsyncClient.get", side_effect=Exception("Network Down"))

    # Пытаемся получить курс
    rate = await service.get_rate("USD", "EUR")

    # Должен сработать Fail-safe механизм
    assert rate == Decimal("1.00")
