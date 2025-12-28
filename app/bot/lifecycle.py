from telegram.ext import CommandHandler

from app.bot.handlers import start_command
from app.bot.loader import ptb_app


async def start_bot():
    if not ptb_app:
        print("⚠️ [Bot]: BOT_TOKEN not found, skipping bot initialization")
        return

    # Register handlers
    ptb_app.add_handler(CommandHandler("start", start_command))

    await ptb_app.initialize()
    print("--- [Bot]: Initialized successfully")


async def stop_bot():
    if ptb_app:
        await ptb_app.shutdown()
        print("--- [Bot]: Shutdown successfully")
