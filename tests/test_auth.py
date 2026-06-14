import hashlib
import hmac
import json
import urllib.parse

import pytest
from fastapi import HTTPException

from app.dependencies import verify_telegram_authentication

BOT_TOKEN = "test-token"


def build_init_data(data: dict[str, str]) -> str:
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    data_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    return urllib.parse.urlencode({**data, "hash": data_hash})


@pytest.mark.asyncio
async def test_verify_telegram_authentication_rejects_missing_header(monkeypatch):
    monkeypatch.setattr("app.dependencies.BOT_TOKEN", BOT_TOKEN)

    with pytest.raises(HTTPException) as error:
        await verify_telegram_authentication(None)

    assert error.value.status_code == 401
    assert error.value.detail == "Missing auth header"


@pytest.mark.asyncio
async def test_verify_telegram_authentication_rejects_missing_hash(monkeypatch):
    monkeypatch.setattr("app.dependencies.BOT_TOKEN", BOT_TOKEN)
    init_data = urllib.parse.urlencode(
        {
            "auth_date": "1710000000",
            "user": json.dumps({"id": 12345}, separators=(",", ":")),
        }
    )

    with pytest.raises(HTTPException) as error:
        await verify_telegram_authentication(init_data)

    assert error.value.status_code == 401
    assert error.value.detail == "No hash provided"


@pytest.mark.asyncio
async def test_verify_telegram_authentication_returns_user_data_with_string_id(monkeypatch):
    monkeypatch.setattr("app.dependencies.BOT_TOKEN", BOT_TOKEN)
    user = {"id": 12345, "first_name": "TestUser", "username": "testuser"}
    init_data = build_init_data(
        {
            "auth_date": "1710000000",
            "query_id": "test-query",
            "user": json.dumps(user, separators=(",", ":")),
        }
    )

    result = await verify_telegram_authentication(init_data)

    assert result == {"id": "12345", "first_name": "TestUser", "username": "testuser"}


@pytest.mark.asyncio
async def test_verify_telegram_authentication_preserves_hash_mismatch_status(monkeypatch):
    monkeypatch.setattr("app.dependencies.BOT_TOKEN", BOT_TOKEN)
    init_data = build_init_data(
        {
            "auth_date": "1710000000",
            "user": json.dumps({"id": 12345}, separators=(",", ":")),
        }
    ).replace("hash=", "hash=invalid", 1)

    with pytest.raises(HTTPException) as error:
        await verify_telegram_authentication(init_data)

    assert error.value.status_code == 403
    assert error.value.detail == "Data integrity check failed"


@pytest.mark.asyncio
async def test_verify_telegram_authentication_rejects_bad_user_json(monkeypatch):
    monkeypatch.setattr("app.dependencies.BOT_TOKEN", BOT_TOKEN)
    init_data = build_init_data(
        {
            "auth_date": "1710000000",
            "user": "{bad-json",
        }
    )

    with pytest.raises(HTTPException) as error:
        await verify_telegram_authentication(init_data)

    assert error.value.status_code == 401
    assert error.value.detail == "Invalid authentication data"
