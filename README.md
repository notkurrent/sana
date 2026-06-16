# Sana — AI-Powered Personal Finance Tracker 🚀

[![Run Tests](https://github.com/notkurrent/sana/actions/workflows/tests.yml/badge.svg)](https://github.com/notkurrent/sana/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Sana** is a seamless Telegram Mini App (TMA) designed to make personal finance tracking intuitive, fast, and smart. Unlike traditional apps, Sana lives right inside your messenger, offering instant access without logins or loading screens.

It combines a modern, responsive **SPA frontend** with a robust **Python backend** and integrates **Google Gemini AI** to provide personalized financial advice based on your spending habits.

![Sana Logo Banner](banner.png)

---

## ✨ Key Features

- **⚡️ Seamless Integration:** Works directly inside Telegram using TMA technology. No installation required.
- **🌍 Multi-Currency Support:** Track expenses in any currency (USD, EUR, KZT, TRY, etc.). The app automatically stores the original amount and currency while keeping your main balance consistent.
- **📝 Smart Notes:** Add context to your spending with optional notes. Notes appear elegantly in the transaction list using an Apple-style layout.
- **🧠 Smart AI Advisor:** Integrated **Google Gemini** analyzes your transactions to give actionable financial tips, summaries, and anomaly detection.
- **💎 Native-Like UX:** Optimized for "Zero Latency" feel with 56px touch targets, optimistic UI updates, haptic feedback, and iOS-style swipe gestures.
- **🔒 Bank-Grade Security:** Implements strict `HMAC SHA-256` validation to verify Telegram initialization data.
- **📊 Analytics:** Interactive doughnut charts and a custom-built calendar view that correctly aggregates daily totals.

---

## 🛠️ Technology Stack

### Frontend

- **Core:** Vanilla JavaScript (ES6+), HTML5, CSS3.
- **Architecture:** Single Page Application (SPA).
- **Design:** Custom Adaptive CSS (Dark/Light mode support based on Telegram theme).
- **Visualization:** Chart.js.

### Backend

- **Framework:** Python (FastAPI).
- **Architecture:** Modular Monolith (Clean Architecture).
- **ORM:** **SQLAlchemy v2** (Async) + **Alembic** (Migrations).
- **Database:** PostgreSQL 15 (via Supabase / Docker).
- **Driver:** `asyncpg` (High-performance Asynchronous Driver).
- **Validation:** Pydantic (Strong Typing).
- **AI:** Google Generative AI (Gemini 2.5 Flash).
- **Testing:** Pytest & Pytest-Asyncio.

### Deployment

- **Platform:** DigitalOcean Droplet (VPS).
- **Infrastructure:** Docker & Docker Compose.
- **Web Server:** Uvicorn behind Nginx (Reverse Proxy).
- **SSL:** Automated via Certbot (Let's Encrypt).

---

## 🚀 Project Structure

```text
Sana-Project/
├── .github/
│   └── workflows/
│       ├── tests.yml       # 🧪 CI: Run Pytest
│       └── deploy.yml      # 🚀 CD: Deploy to DigitalOcean
├── alembic/                # 🗄️ Database Migrations
├── app/                    # 🐍 Backend Logic
│   ├── bot/                # 🤖 Telegram Bot (Decoupled)
│   │   ├── __init__.py
│   │   ├── handlers.py     # Command Handlers
│   │   ├── lifecycle.py    # Startup/Shutdown Logic
│   │   └── loader.py       # Bot Instance
│   ├── config.py           # Environment Config
│   ├── database.py         # Async Engine & Session
│   ├── dependencies.py     # Auth & DI
│   ├── models/             # Data Models
│   │   ├── __init__.py
│   │   ├── schemas.py      # Pydantic Schemas
│   │   └── sql.py          # SQLAlchemy Models
│   ├── routers/            # API Endpoints
│   │   ├── __init__.py
│   │   ├── ai.py           # Gemini Logic
│   │   ├── categories.py
│   │   ├── transactions.py
│   │   ├── users.py        # User Management
│   │   └── webhook.py      # Bot Webhook
│   └── services/           # ⚙️ Business Logic & Core
│       ├── __init__.py
│       ├── analytics.py    # 📊 Aggregation Service
│       └── currency.py     # Currency Logic
├── tests/                  # 🧪 Automated Tests (Unit & Integration)
│   ├── conftest.py         # Test fixtures
│   ├── test_ai.py
│   ├── test_analytics.py
│   ├── test_api.py
│   ├── test_auth.py
│   ├── test_currency.py
│   └── test_sanity.py
├── webapp/                 # 🎨 Frontend Source (SPA)
│   ├── index.html          # Main entry point
│   ├── script.js           # UI Logic
│   └── style.css           # Styles
├── .dockerignore           # Docker build exclusions
├── .env.example            # Environment variables template
├── .gitignore
├── alembic.ini             # Alembic Config
├── banner.png              # 🖼️ Project Banner
├── CONTRIBUTING.md         # Contribution Guide
├── docker-compose.dev.yml  # Local Development (Hot-reload)
├── docker-compose.yml      # Production orchestration
├── Dockerfile              # Docker image config
├── LICENSE
├── main.py                 # 🚀 App Entry Point
├── pyproject.toml          # Ruff configuration
├── pytest.ini              # Test Configuration
├── requirements.txt        # Python dependencies
├── SECURITY.md             # Security Policy
└── setup_bot.py            # 🤖 Webhook/Bot setup
```

---

## ⚙️ How to Run (Docker)

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/notkurrent/sana.git
    cd sana
    ```

2.  **Set up Environment:**
    Create a `.env` file in the root directory and add your keys:

    ```env
    BOT_TOKEN=your_telegram_bot_token
    DATABASE_URL=your_postgres_url
    GOOGLE_API_KEY=your_gemini_key
    EXCHANGE_RATE_API_KEY=your_exchange_key
    BASE_URL=https://your-domain.com
    WEB_APP_URL=https://your-domain.com
    ```

3.  **Run with Docker Compose:**

    ```bash
    docker compose up -d --build
    ```

4.  **Apply Database Migrations:**
    ```bash
    docker compose exec app alembic upgrade head
    ```

The server will start at `http://localhost:8000`.

---

## 👨‍💻 Local Development (Dev Environment)

To develop comfortably with **Hot-Reload** (changes in code apply instantly) and a safe **Local Database**, follow these steps:

### Prerequisites

1.  **Docker Desktop** installed and running.
2.  **Ngrok** installed (to tunnel Telegram Webhooks to localhost).
3.  A separate **Test Bot** created in @BotFather (e.g., `@SanaDevBot`).

### Step-by-Step Setup

1.  **Create Development Config:**
    Copy the example file and rename it to `.env.dev`.
    _Note: `.env.dev` is git-ignored to protect your secrets._

    ```bash
    cp .env.example .env.dev
    ```

2.  **Start Ngrok:**
    Open a terminal and run ngrok on port 8000:

    ```bash
    ngrok http 8000
    ```

    Copy the provided HTTPS URL (e.g., `https://a1b2.ngrok-free.dev`).

3.  **Configure `.env.dev`:**
    Open `.env.dev` and update:

    - `BOT_TOKEN`: Your **Test Bot** token.
    - `WEB_APP_URL` & `BASE_URL`: The **Ngrok URL** you just copied.
    - `GOOGLE_API_KEY` & `EXCHANGE_RATE_API_KEY`: Add your keys here.
    - `DATABASE_URL`: Leave as is (it's pre-configured for local Docker).

4.  **Configure Test Bot:**
    Go to @BotFather -> Select your Test Bot -> `Mini apps` -> `Menu Button & Main app`.
    Set the URL to your **Ngrok URL**.

5.  **Run Dev Environment:**
    This starts the App (with reload) and a local Postgres DB.

    ```bash
    docker compose -f docker-compose.dev.yml up --build
    ```

6.  **Apply Migrations Locally:**

    ```bash
    docker compose -f docker-compose.dev.yml exec app alembic upgrade head
    ```

7.  **Set Webhook:**
    In a new terminal window, tell Telegram to send updates to your local machine:
    ```bash
    docker exec -it sana_dev_app python setup_bot.py
    ```

🎉 **Ready!** Open your Test Bot in Telegram and start coding. Changes in `main.py` or frontend files will be applied automatically.

---

## 🧪 Automated Testing

The project employs a comprehensive testing strategy using **Pytest** to ensure stability and preventing regressions.

### Test Suite Includes:

1.  **Sanity Tests:** Verifies database connectivity and table creation.
2.  **Unit Tests:** Checks isolated business logic (e.g., currency conversion math, caching mechanisms).
3.  **Integration Tests:** Validates full API workflows (creating transactions, auth bypass, database writes, and balance calculation).
4.  **AI & Analytics:** Verifies budget aggregation logic and mocks external Google Gemini API calls to ensure resilience.

### How to Run Tests Locally

The tests use `TEST_DATABASE_URL`. If it is not set, Pytest defaults to:

```text
postgresql+asyncpg://postgres:password@localhost:5432/sana_test
```

CI creates this PostgreSQL database automatically. For local full test runs, make sure PostgreSQL is running and that the `sana_test` database exists.

1.  **Start local PostgreSQL:**

    ```bash
    docker compose -f docker-compose.dev.yml up -d db
    ```

2.  **Create the test database if it does not exist:**

    ```bash
    docker compose -f docker-compose.dev.yml exec -T db sh -c 'psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '\''sana_test'\''" | grep -q 1 || createdb -U postgres sana_test'
    ```

    This only creates `sana_test` when it is missing. Do not delete Docker volumes or reset the database for normal test runs.

3.  **Activate your virtual environment:**

    ```bash
    source venv/bin/activate
    ```

4.  **Run the tests:**

    ```bash
    pytest tests/ -v
    ```

    To use another test database, set `TEST_DATABASE_URL` before running Pytest.

### CI/CD Pipeline

We use **GitHub Actions** for a complete DevOps cycle:

1.  **Continuous Integration (CI):** On every `push` or `pull_request`, the full test suite (Pytest) runs automatically to prevent regressions.
2.  **Continuous Deployment (CD):** When code is pushed to the `main` branch, a separate workflow automatically:
    - Connects to the Production Server via SSH.
    - Pulls the latest code.
    - Rebuilds Docker containers.
    - **Applies Database Migrations** (`alembic upgrade head`).
    - Cleans up unused Docker images.

This ensures that the Production version is always up-to-date within minutes of a commit.

---

## 🎨 Code Quality

The project uses **Ruff** for fast and strict linting and formatting. Configuration is centralized in `pyproject.toml`.

### Usage

1.  **Linting (Check for errors):**

    ```bash
    ruff check .
    ```

2.  **Formatting (Auto-fix properties):**
    ```bash
    ruff format .
    ```

---

## 🛡️ Security & Architecture

This project was built with a focus on **security**, **scalability**, and **performance**:

1.  **Modern Async Stack:** Fully migrated to **SQLAlchemy (Async)** and **asyncpg**. This allows the server to handle high concurrency without blocking, ensuring the interface remains snappy even under load.
2.  **Resilient Database Connections:** Uses `pool_pre_ping=True` and connection recycling strategies to handle cloud database (Supabase) idle timeouts gracefully. The app automatically recovers lost connections without user errors.
3.  **Deletion Behavior:** Categories use a soft delete pattern and are hidden with `is_active=False`, preserving historical category data. Transactions are physically deleted when removed, matching the user's expectation that a deleted entry is gone.
4.  **Database Migrations:** All database schema changes are managed by **Alembic**, ensuring smooth updates (e.g., adding multi-currency support without losing data).
5.  **HMAC Validation:** Every API request is authenticated using Telegram's `initData` hash (HMAC SHA-256) to ensure requests originate from a verified Telegram session.
6.  **Multi-Currency Architecture:** Transactions store the `original_amount` and `currency` code alongside the base amount, allowing for accurate historical records even if exchange rates change.

---

## 🌱 Open Source & Maintenance

Sana is maintained as an open-source reference implementation for building secure Telegram Mini Apps with a Python backend, PostgreSQL, Docker-based deployment, and a lightweight SPA frontend.

- **Maintainer:** Gayas Serikuly (`@notkurrent`)
- **License:** MIT
- **Contributions:** Bug reports, documentation improvements, tests, and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Security:** Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

---

### 📬 Feedback & Support

If you have any questions or suggestions, feel free to open an issue or contact the developer via Telegram.

_Developed by Gayas Serikuly_
