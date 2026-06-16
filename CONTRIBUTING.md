# Contributing to Sana

Thanks for taking the time to improve Sana. This project is a Telegram Mini App
for personal finance tracking, so changes should be careful with user data,
authentication, database migrations, and Telegram-specific behavior.

## Good first contributions

- Documentation improvements
- Bug reports with clear reproduction steps
- Small UI fixes in `webapp/`
- Tests for existing backend behavior
- Safer error handling around external APIs

## Development setup

1. Clone the repository:

   ```bash
   git clone https://github.com/notkurrent/sana.git
   cd sana
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env.dev
   ```

3. Start the local stack:

   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

4. Apply migrations:

   ```bash
   docker compose -f docker-compose.dev.yml exec app alembic upgrade head
   ```

## Checks

Run the smallest checks that match your change:

```bash
pytest tests/ -v
ruff check .
ruff format .
```

For frontend changes, manually test the affected Telegram Mini App flow in a
development bot before opening a pull request.

## Pull requests

- Keep changes focused and easy to review.
- Explain what changed, why it changed, and how you tested it.
- Do not commit `.env` files, real tokens, API keys, or production data.
- Keep database schema changes in Alembic migrations.
- Avoid broad refactors unless they are needed for the specific fix.

## Security-sensitive areas

Please be extra careful with:

- Telegram `initData` and HMAC validation
- User identity and session handling
- Transaction and category deletion behavior
- Database migrations and production deployment scripts
- API keys, bot tokens, and service credentials
