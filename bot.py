import os
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes
from dotenv import load_dotenv

# --- Настройка логирования ---
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", 
    level=logging.INFO
)
# Уменьшаем "шум" от http-клиента, который использует python-telegram-bot
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# --- Загрузка переменных окружения ---
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
WEB_APP_URL = os.getenv("WEB_APP_URL") 

# Раздельные, более точные проверки при старте
if not BOT_TOKEN:
    logger.critical("КРИТИЧЕСКАЯ ОШИБКА: BOT_TOKEN не найден в .env файле.")
    raise SystemExit("Переменная BOT_TOKEN не установлена.")

if not WEB_APP_URL:
    logger.critical("КРИТИЧЕСКАЯ ОШИБКА: WEB_APP_URL не найден в .env файле.")
    raise SystemExit("Переменная WEB_APP_URL не установлена.")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Отправляет приветственное сообщение с кнопкой Web App."""
    
    if not update.effective_user:
        logger.warning("Получено 'start' обновление без 'effective_user'.")
        return

    user = update.effective_user
    user_name = user.first_name
    
    # ЛУЧШЕ: Логируем, какой пользователь запустил бота
    logger.info(f"Пользователь {user.id} ({user_name}) запустил бота.")
    
    welcome_text = (
        f"Hello, {user_name}! 🚀\n\n"
        "Welcome to Sana — your personal finance assistant in Telegram."
    )

    keyboard = [
        [InlineKeyboardButton("✨ Open Sana", web_app=WebAppInfo(url=WEB_APP_URL))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    try:
        await update.message.reply_text(
            welcome_text, 
            reply_markup=reply_markup
        )
    except Exception as e:
        # ЛУЧШЕ: Перехватываем ошибки (напр. если бот заблокирован)
        logger.error(f"Не удалось отправить /start сообщение пользователю {user.id}: {e}")

def main() -> None:
    """Запускает бота."""
    try:
        app = ApplicationBuilder().token(BOT_TOKEN).build()
        app.add_handler(CommandHandler("start", start))
        
        logger.info(f"Бот запускается... Web App URL: {WEB_APP_URL}")
        
        app.run_polling(allowed_updates=Update.ALL_TYPES)
        
    except Exception as e:
        logger.critical(f"Не удалось запустить бота: {e}")
        raise

if __name__ == "__main__":
    main()