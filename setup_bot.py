import asyncio
import os
import sys

from dotenv import load_dotenv
from telegram import Bot

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
BASE_URL = os.getenv("BASE_URL")


async def main():
    """
    Sets up the Telegram Webhook using environment variables.
    """
    if not BOT_TOKEN or not BASE_URL:
        print("Error: BOT_TOKEN or BASE_URL is missing in environment variables.")
        sys.exit(1)

    bot = Bot(token=BOT_TOKEN)
    webhook_url = f"{BASE_URL}/webhook"

    print(f"Setting webhook to: {webhook_url} ...")

    try:
        success = await bot.set_webhook(url=webhook_url)
        if success:
            print("Webhook set successfully.")
        else:
            print("Failed to set webhook (API returned False).")
    except Exception as e:
        print(f"Error setting webhook: {e}")
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"Runtime error: {e}")
        sys.exit(1)
