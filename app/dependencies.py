import hmac
import hashlib
import json
import urllib.parse
from fastapi import Header, HTTPException, status
from app.config import BOT_TOKEN


async def verify_telegram_authentication(
    # 🔥 ВАЖНО: В твоем JS (строка 61) хедер с дефисом, поэтому тут alias тоже с дефисом
    x_telegram_init_data: str = Header(None, alias="X-Telegram-Init-Data")
):
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="Missing auth header")

    if not BOT_TOKEN:
        print("❌ [AUTH]: BOT_TOKEN is missing on server")
        raise HTTPException(status_code=500, detail="Server config error")

    try:
        parsed_data = dict(urllib.parse.parse_qsl(x_telegram_init_data))
        received_hash = parsed_data.pop("hash", None)
        if not received_hash:
            raise HTTPException(status_code=401, detail="No hash provided")

        # Сортировка параметров для проверки хеша
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))

        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

        if calculated_hash != received_hash:
            print(f"❌ [AUTH FAIL] Hash mismatch")
            raise HTTPException(status_code=403, detail="Data integrity check failed")

        user_data = json.loads(parsed_data.get("user", "{}"))
        user_data["id"] = str(user_data["id"])

        return user_data

    except Exception as e:
        print(f"❌ [AUTH ERROR]: {e}")
        raise HTTPException(status_code=401, detail="Invalid authentication data")
