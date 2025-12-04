# Sana — AI-Powered Personal Finance Tracker 🚀

**Sana** is a seamless Telegram Mini App (TMA) designed to make personal finance tracking intuitive, fast, and smart. Unlike traditional apps, Sana lives right inside your messenger, offering instant access without logins or loading screens.

It combines a modern, responsive **SPA frontend** with a robust **Python backend** and integrates **Google Gemini AI** to provide personalized financial advice based on your spending habits.

![Sana Logo Banner](banner.png)

---

## ✨ Key Features

- **⚡️ Seamless Integration:** Works directly inside Telegram using TMA technology. No installation required.
- **🧠 Smart AI Advisor:** Integrated **Google Gemini** analyzes your transactions to give actionable financial tips, summaries, and anomaly detection.
- **💎 Instant UX:** Optimized for "Zero Latency" feel with optimistic UI updates, haptic feedback, and iOS-style swipe gestures.
- **🔒 Bank-Grade Security:** Implements strict `HMAC SHA-256` validation to verify Telegram initialization data, preventing unauthorized API access.
- **📊 Analytics:** Interactive doughnut charts and a custom-built calendar view for detailed expense tracking.

---

## 🛠️ Technology Stack

### Frontend

- **Core:** Vanilla JavaScript (ES6+), HTML5, CSS3.
- **Architecture:** Single Page Application (SPA).
- **Design:** Custom Adaptive CSS (Dark/Light mode support based on Telegram theme).
- **Visualization:** Chart.js.

### Backend

- **Framework:** Python (FastAPI).
- **Server:** Uvicorn / Gunicorn.
- **Database:** PostgreSQL (via Supabase).
- **AI:** Google Generative AI (Gemini 2.5 Flash).
- **Security:** HMAC Data Validation & Dependency Injection.

### Deployment

- **Platform:** DigitalOcean Droplet (VPS).
- **Infrastructure:** Docker & Docker Compose.
- **Web Server:** Uvicorn behind Nginx (Reverse Proxy).
- **SSL:** Automated via Certbot (Let's Encrypt).

---

## 🚀 Project Structure

```text
Sana-Project/
├── webapp/                 # Frontend Source (SPA)
│   ├── index.html          # Main entry point
│   ├── style.css           # Adaptive styles
│   └── script.js           # UI Logic & API integration
├── main.py                 # FastAPI Backend Entry point
├── constants.py            # AI Prompts & Configuration
├── setup_bot.py            # Webhook setup utility
├── requirements.txt        # Python dependencies
├── Dockerfile              # Docker image configuration
├── docker-compose.yml      # Container orchestration config
├── .gitignore              # Git configuration
└── README.md               # Project Documentation
```

---

## ⚙️ How to Run (Docker)

1.  **Clone the repository:**

    ```bash
    git clone [https://github.com/notkurrent/sana.git](https://github.com/notkurrent/sana.git)
    cd sana
    ```

2.  **Set up Environment:**
    Create a `.env` file in the root directory and add your keys:

    ```env
    BOT_TOKEN=your_telegram_bot_token
    DATABASE_URL=your_postgres_url
    GOOGLE_API_KEY=your_gemini_key
    BASE_URL=https://your-domain.com
    WEB_APP_URL=https://your-domain.com
    ```

3.  **Run with Docker Compose:**
    ```bash
    docker compose up -d --build
    ```

The server will start at `http://localhost:8000`.

---

## 🛡️ Security & Architecture

This project was built with a focus on **security** and **performance**:

1.  **Consolidated Architecture:** Uses a single service for API, Webhook, and Static files to eliminate cold starts and reduce latency.
2.  **HMAC Validation:** Every API request is authenticated using Telegram's `initData` hash to ensure requests originate from a verified Telegram session.
3.  **CORS Protection:** Strict Allow-Origin policies restricted to the app's domain.

---

### 📬 Feedback & Support

If you have any questions or suggestions, feel free to open an issue or contact the developer via Telegram.

_Developed by Gayas Serikuly_
