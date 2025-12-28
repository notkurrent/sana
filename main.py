import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.bot.lifecycle import start_bot, stop_bot
from app.routers import ai, categories, transactions, users, webhook
from app.services.currency import CurrencyService

# --- Global Cache ---
SPA_HTML_CACHE = None


# --- Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Cache Frontend
    global SPA_HTML_CACHE
    html_path = "webapp/index.html"
    if os.path.exists(html_path):
        with open(html_path, encoding="utf-8") as f:
            SPA_HTML_CACHE = f.read()
            print(f"✅ Frontend cached ({len(SPA_HTML_CACHE)} bytes)")
    else:
        print("⚠️ Frontend index.html not found during startup")

    # 2. Start Services
    await start_bot()

    # 3. Start Background Tasks
    # Keep specific reference to avoid GC
    currency_task = asyncio.create_task(CurrencyService().start_periodic_update())

    # 3.1. Warmup Cache (Avoid Race Condition)
    # Ensure rates are loaded (or attempted) before accepting requests
    print("⏳ Warming up currency cache...")
    await CurrencyService().get_all_rates()
    print("✅ Currency cache warmup complete")

    yield

    # 4. Graceful Shutdown
    print("🛑 Shutting down background tasks...")
    currency_task.cancel()
    try:
        await currency_task
    except asyncio.CancelledError:
        print("✅ Currency task cancelled")

    await stop_bot()


# --- FastAPI Initialization ---
app = FastAPI(title="Sana Finance API", lifespan=lifespan)

# --- CORS ---
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- API Routers ---
app.include_router(transactions.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(webhook.router)


# --- Static Files & SPA Frontend ---
app.mount("/static", StaticFiles(directory="webapp"), name="static")


@app.get("/{full_path:path}", response_class=HTMLResponse)
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404)

    if SPA_HTML_CACHE:
        return HTMLResponse(content=SPA_HTML_CACHE)

    # Fallback (dev mode or if file missing on startup but appeared later)
    html_path = "webapp/index.html"
    if os.path.exists(html_path):
        with open(html_path, encoding="utf-8") as f:
            return HTMLResponse(content=f.read())

    return HTMLResponse(content="<h1>Error: index.html not found</h1>", status_code=404)
