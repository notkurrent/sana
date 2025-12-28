import asyncio
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation

import httpx

from app.config import EXCHANGE_RATE_API_KEY

logger = logging.getLogger(__name__)


class CurrencyService:
    _instance = None
    _rates: dict = {}
    _last_update: datetime = None

    BASE_API_URL = "https://v6.exchangerate-api.com/v6"

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    async def start_periodic_update(self):
        """Starts the infinite loop for updating currency rates."""
        logger.info("Starting background currency update task...")
        while True:
            try:
                await self._update_rates_from_api("USD")
            except Exception as e:
                logger.error(f"Error in periodic update: {e}")

            # Wait for 1 hour before next update
            await asyncio.sleep(3600)

    async def get_rate(self, from_currency: str, to_currency: str = "USD") -> Decimal:
        from_currency = from_currency.upper()
        to_currency = to_currency.upper()

        if from_currency == to_currency:
            return Decimal("1.00")

        if not EXCHANGE_RATE_API_KEY:
            logger.error("EXCHANGE_RATE_API_KEY is missing in .env")
            return Decimal("1.00")

        # NOTE: We do NOT wait for API here anymore.
        # If cache is empty, we return 1.00 immediately to avoid blocking.
        # The background task is responsible for filling/updating _rates.

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

    async def get_all_rates(self) -> dict:
        """Returns the cached dictionary of all rates (Base: USD)."""
        if not self._rates:
            try:
                await self._update_rates_from_api("USD")
            except Exception:
                pass
        return self._rates

    async def _update_rates_from_api(self, base: str):
        url = f"{self.BASE_API_URL}/{EXCHANGE_RATE_API_KEY}/latest/{base}"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=5.0)
                if resp.status_code == 200:
                    data = resp.json()
                    self._rates = data.get("conversion_rates", {})
                    self._last_update = datetime.now()
                    logger.info("Currency rates updated from API (background).")
                else:
                    logger.warning(f"Failed to update rates: {resp.status_code}")
        except Exception as e:
            logger.error(f"Network error updating rates: {e}")
