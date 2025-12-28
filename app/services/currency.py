import logging
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

import httpx

from app.config import EXCHANGE_RATE_API_KEY

logger = logging.getLogger(__name__)


class CurrencyService:
    _instance = None
    _rates: dict = {}
    _last_update: datetime = None

    CACHE_TTL = timedelta(hours=1)
    BASE_API_URL = "https://v6.exchangerate-api.com/v6"

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    async def get_rate(self, from_currency: str, to_currency: str = "USD") -> Decimal:
        from_currency = from_currency.upper()
        to_currency = to_currency.upper()

        if from_currency == to_currency:
            return Decimal("1.00")

        if not EXCHANGE_RATE_API_KEY:
            logger.error("EXCHANGE_RATE_API_KEY is missing in .env")
            return Decimal("1.00")

        # Refresh cache if empty or expired
        if not self._rates or self._is_cache_expired():
            await self._update_rates_from_api("USD")

        try:
            rate_base_to_from = self._get_rate_value(from_currency)
            rate_base_to_target = self._get_rate_value(to_currency)

            # Calculate cross-rate via USD
            # Formula: (1 / Rate_From_USD) * Rate_To_USD
            rate = (Decimal("1.00") / rate_base_to_from) * rate_base_to_target
            return rate

        except (InvalidOperation, ZeroDivisionError, TypeError) as e:
            logger.error(f"Error calculating rate: {e}")
            return Decimal("1.00")

    def _get_rate_value(self, currency: str) -> Decimal:
        if currency in self._rates:
            return Decimal(str(self._rates[currency]))
        return Decimal("1.00")

    def _is_cache_expired(self) -> bool:
        if not self._last_update:
            return True
        return datetime.now() - self._last_update > self.CACHE_TTL

    async def _update_rates_from_api(self, base: str):
        url = f"{self.BASE_API_URL}/{EXCHANGE_RATE_API_KEY}/latest/{base}"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=5.0)
                if resp.status_code == 200:
                    data = resp.json()
                    self._rates = data.get("conversion_rates", {})
                    self._last_update = datetime.now()
                    logger.info("Currency rates updated from API.")
                else:
                    logger.warning(f"Failed to update rates: {resp.status_code}")
        except Exception as e:
            logger.error(f"Network error updating rates: {e}")
