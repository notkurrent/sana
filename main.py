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
from app.routers import transactions, categories, ai, users

# --- Bot Initialization ---
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


# --- FastAPI Initialization ---
app = FastAPI(title="Sana Finance API")

# --- CORS ---
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Lifecycle Events (Startup/Shutdown) ---
@app.on_event("startup")
async def startup_event():
    if ptb_app:
        await ptb_app.initialize()
        print("--- [Bot]: Initialized successfully")


@app.on_event("shutdown")
async def shutdown_event():
    if ptb_app:
        await ptb_app.shutdown()


# --- API Routers ---
app.include_router(transactions.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(users.router, prefix="/api")


# --- Telegram Webhook ---
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


# --- Static Files & SPA Frontend ---
app.mount("/static", StaticFiles(directory="webapp"), name="static")


@app.get("/{full_path:path}", response_class=HTMLResponse)
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404)

    html_path = "webapp/index.html"
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Error: index.html not found</h1>", status_code=404)
