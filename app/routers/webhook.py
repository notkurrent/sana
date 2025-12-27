from fastapi import APIRouter, Request
from telegram import Update
from app.bot.loader import ptb_app

router = APIRouter()

@router.post("/webhook")
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
