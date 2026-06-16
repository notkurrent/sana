import logging

from telegram.ext import CommandHandler

from app.bot.handlers import start_command
from app.bot.loader import ptb_app

logger = logging.getLogger(__name__)


async def start_bot():
    if not ptb_app:
        logger.warning("Bot credentials are not configured, skipping bot initialization")
        return

    # Register handlers
    ptb_app.add_handler(CommandHandler("start", start_command))

    await ptb_app.initialize()
    logger.info("Bot initialized successfully")


async def stop_bot():
    if ptb_app:
        await ptb_app.shutdown()
        logger.info("Bot shutdown successfully")
