import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

# Telegram imports
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

# App imports
from app.config import WEB_APP_URL, BOT_TOKEN
from app.database import init_db_pool, close_db_pool
from app.routers import transactions, categories, ai

# --- Инициализация Бота ---
ptb_app = None
if BOT_TOKEN:
    ptb_app = Application.builder().token(BOT_TOKEN).build()


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_name = update.effective_user.first_name
    welcome_text = f"Hello, {user_name}! 🚀\nWelcome to Sana — your personal finance assistant."

    keyboard = [[InlineKeyboardButton("✨ Open Sana", web_app=WebAppInfo(url=WEB_APP_URL))]]
    await update.message.reply_text(welcome_text, reply_markup=InlineKeyboardMarkup(keyboard))


if ptb_app:
    ptb_app.add_handler(CommandHandler("start", start_command))


# --- Инициализация FastAPI ---
app = FastAPI(title="Sana Finance API")

# --- CORS ---
origins = ["*"]  # Для разработки разрешаем всё
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Жизненный цикл (Startup/Shutdown) ---
@app.on_event("startup")
async def startup_event():
    # 1. База данных
    init_db_pool()
    # 2. Бот
    if ptb_app:
        await ptb_app.initialize()
        print("--- [Bot]: Initialized successfully")


@app.on_event("shutdown")
async def shutdown_event():
    # 1. Бот
    if ptb_app:
        await ptb_app.shutdown()
    # 2. База данных
    close_db_pool()


# --- Подключение роутеров API ---
app.include_router(transactions.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(ai.router, prefix="/api")


# --- Webhook для Telegram ---
@app.post("/webhook")
async def telegram_webhook(request: Request):
    if not ptb_app:
        return {"error": "Bot not initialized"}
    try:
        data = await request.json()
        update = Update.de_json(data, ptb_app.bot)
        await ptb_app.process_update(update)
        return {"status": "ok"}
    except Exception as e:
        print(f"Webhook error: {e}")
        return {"status": "error"}


# --- 🔥 ВАЖНО: Статика и Frontend (SPA) ---
# Обслуживаем папку webapp
app.mount("/static", StaticFiles(directory="webapp"), name="static")


# Catch-all route: Любой запрос, не попавший в API, отдает index.html
@app.get("/{full_path:path}", response_class=HTMLResponse)
async def serve_spa(full_path: str):
    # Если запрашивают файл API, которого нет - 404
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404)

    # Иначе отдаем index.html
    html_path = "webapp/index.html"
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Error: index.html not found</h1>", status_code=404)
