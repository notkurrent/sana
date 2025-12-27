from telegram.ext import Application
from app.config import BOT_TOKEN

ptb_app = None
if BOT_TOKEN:
    ptb_app = Application.builder().token(BOT_TOKEN).build()
