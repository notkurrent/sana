import os
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
from fastapi import FastAPI, Request
from dotenv import load_dotenv
from contextlib import asynccontextmanager # <--- ЭТОТ ИМПОРТ НУЖЕН

# --- Настройка ---
load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")
WEB_APP_URL = os.getenv("WEB_APP_URL") 
PORT = int(os.environ.get("PORT", "8080")) 

# --- Логирование ---
logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
logger = logging.getLogger(__name__)

# --- FastAPI App ---
webhook_app = FastAPI()

# --- Настройка Telegram Application ---
try:
    # application = Application.builder().token(BOT_TOKEN).build()
    # ⬆️ Оставляем только build() здесь. initialize() идет в lifespan.
    application = Application.builder().token(BOT_TOKEN).build() 
except Exception as e:
    logger.critical(f"Не удалось инициализировать Telegram Application: {e}")
    raise SystemExit("Неверный BOT_TOKEN.")


# --- Хендлеры ---
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка команды /start."""
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo 
    
    if not update.effective_user:
        return
        
    user_name = update.effective_user.first_name
    welcome_text = (
        f"Hello, {user_name}! 🚀\n\n"
        "Welcome to Sana — your personal finance assistant in Telegram."
    )
    
    keyboard = [[InlineKeyboardButton("✨ Open Sana", web_app=WebAppInfo(url=WEB_APP_URL))]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(welcome_text, reply_markup=reply_markup)

application.add_handler(CommandHandler("start", start))


# --- Webhook Эндпоинт (то, что принимает данные от Telegram) ---
@webhook_app.post(f"/{BOT_TOKEN}")
async def telegram_webhook(request: Request):
    """Основной эндпоинт для приема Webhook."""
    update_json = await request.json()
    
    # Обрабатываем через приложение Telegram
    update = Update.de_json(update_json, application.bot)
    await application.process_update(update) # <-- ЭТО ОЧЕНЬ ВАЖНО, ОСТАВЛЯЕМ!
    
    # Telegram ждет быстрого ответа
    return {"message": "ok"}

@webhook_app.get("/")
async def root():
    """Проверка доступности (Render Health Check)"""
    return {"status": "ok", "service": "Sana Telegram Webhook Listener"}

# --- Функция установки Webhook ---
async def set_webhook_url(base_url: str):
    """Устанавливает URL Webhook на серверах Telegram."""
    webhook_url = f"{base_url}/{BOT_TOKEN}"
    
    # Это важно! Webhook должен указывать на публичный URL Render
    success = await application.bot.set_webhook(url=webhook_url)
    
    if success:
        logger.info(f"✅ Webhook успешно установлен на: {webhook_url}")
    else:
        logger.error(f"❌ НЕ УДАЛОСЬ установить Webhook.")
        
    return success

# --- Main Lifespan (Устанавливаем Webhook при запуске Render) ---
@asynccontextmanager
async def lifespan_webhook(webhook_app: FastAPI):
    
    # 🛠️ ФИКС: Инициализируем Application асинхронно
    await application.initialize() 
    
    render_url = os.getenv("RENDER_EXTERNAL_URL") 
    
    if render_url and BOT_TOKEN:
        await set_webhook_url(render_url)
    
    yield
    
    # 🛠️ ФИКС: Завершаем работу Application для чистоты
    await application.shutdown() 

webhook_app.router.lifespan_context = lifespan_webhook

# --- Запуск (Для Render) ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(webhook_app, host="0.0.0.0", port=PORT)