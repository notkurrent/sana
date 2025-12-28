from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.ext import ContextTypes

from app.config import WEB_APP_URL


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_name = update.effective_user.first_name
    welcome_text = f"Hello, {user_name}! 🚀\nWelcome to Sana — your personal finance assistant."

    keyboard = [[InlineKeyboardButton("✨ Open Sana", web_app=WebAppInfo(url=WEB_APP_URL))]]
    await update.message.reply_text(welcome_text, reply_markup=InlineKeyboardMarkup(keyboard))
