import os
import asyncio
import sys
from dotenv import load_dotenv
from telegram import Bot

# Загружаем переменные
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
BASE_URL = os.getenv("BASE_URL")


async def main():
    """
    Асинхронная функция для установки Webhook.
    """
    if not BOT_TOKEN or not BASE_URL:
        print("--- [Setup Bot]: ❌ ОШИБКА: BOT_TOKEN или RENDER_EXTERNAL_URL не найдены.")
        print("--- [Setup Bot]: Убедитесь, что они установлены в Environment на Render.")
        sys.exit(1)  # Выход с ошибкой

    bot = Bot(token=BOT_TOKEN)
    webhook_url = f"{BASE_URL}/webhook"

    print(f"--- [Setup Bot]: Пытаемся установить Webhook на: {webhook_url} ...")

    try:
        success = await bot.set_webhook(url=webhook_url)
        if success:
            print("--- [Setup Bot]: ✅ Webhook успешно установлен!")
        else:
            print("--- [Setup Bot]: ❌ НЕ УДАЛОСЬ установить Webhook (ответ !success).")
    except Exception as e:
        print(f"--- [Setup Bot]: ❌ Ошибка при установке Webhook: {e}")
        sys.exit(1)  # Выход с ошибкой


if __name__ == "__main__":
    print("--- [Setup Bot]: Запуск скрипта установки Webhook...")
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"--- [Setup Bot]: ❌ Не удалось запустить asyncio: {e}")
        sys.exit(1)
