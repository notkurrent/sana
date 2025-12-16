import os
import sys
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
WEB_APP_URL = os.getenv("WEB_APP_URL")
BASE_URL = os.getenv("BASE_URL")

# --- 🔥 FIX DATABASE URL ---
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("❌ CRITICAL ERROR: DATABASE_URL is missing!")
    sys.exit(1)

# Автоматически меняем драйвер на асинхронный, если забыли в .env
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

if not BOT_TOKEN:
    print("⚠️ WARNING: BOT_TOKEN is missing. Bot functionality will be disabled.")
