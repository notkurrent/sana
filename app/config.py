import os
import sys
from dotenv import load_dotenv

# Загружаем переменные (Docker сам их прокидывает, но для локальных тестов полезно)
load_dotenv()

# Окружение
BOT_TOKEN = os.getenv("BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
WEB_APP_URL = os.getenv("WEB_APP_URL")
BASE_URL = os.getenv("BASE_URL")

# Проверка критических переменных
if not DATABASE_URL:
    print("❌ CRITICAL ERROR: DATABASE_URL is missing!")
    sys.exit(1)

if not BOT_TOKEN:
    print("⚠️ WARNING: BOT_TOKEN is missing. Bot functionality will be disabled.")
