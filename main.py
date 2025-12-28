import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.bot.lifecycle import start_bot, stop_bot

# App imports
from app.routers import ai, categories, transactions, users, webhook

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
    await start_bot()


@app.on_event("shutdown")
async def shutdown_event():
    await stop_bot()


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

    html_path = "webapp/index.html"
    if os.path.exists(html_path):
        with open(html_path, encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Error: index.html not found</h1>", status_code=404)
