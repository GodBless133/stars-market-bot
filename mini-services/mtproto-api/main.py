import asyncio
import json
import os
import re
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from telethon import TelegramClient
from telethon.sessions import StringSession

# ---- Configuration (fail-closed: no hardcoded secrets) ----
# API_ID/API_HASH come from env. If missing/invalid at startup, log and exit.
API_ID = int(os.environ.get("TG_API_ID", "0") or "0")
API_HASH = os.environ.get("TG_API_HASH", "") or ""
PORT = int(os.environ.get("PORT", "8080") or "8080")

# Shared-secret auth: the bot must send `X-MTPROTO-KEY: <MTPROTO_API_KEY>` on
# /getcode and /validate. If MTPROTO_API_KEY is unset, those endpoints refuse all
# requests (fail-closed).
MTPROTO_API_KEY = os.environ.get("MTPROTO_API_KEY", "") or ""

if API_ID == 0 or not API_HASH:
    print(
        "[mtproto-api] FATAL: TG_API_ID and TG_API_HASH must be set in env "
        "(got API_ID=%r, API_HASH=%r). Exiting." % (API_ID, "<set>" if API_HASH else "<empty>"),
        file=sys.stderr,
    )
    sys.exit(1)

if not MTPROTO_API_KEY:
    print(
        "[mtproto-api] WARNING: MTPROTO_API_KEY not set — /getcode and /validate "
        "will refuse all requests (fail-closed).",
        file=sys.stderr,
    )


# ---- Lifespan (replaces deprecated @app.on_event("shutdown")) ----
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # cleanup: disconnect all cached Telethon clients
    for client in list(clients_cache.values()):
        try:
            await client.disconnect()
        except Exception:
            pass


app = FastAPI(title="MTProto API", version="1.0.0", lifespan=lifespan)

# CORS — open origins, NO credentials (no cookie auth on this service).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Кэш клиентов: phone → TelegramClient
clients_cache = {}


class GetCodeRequest(BaseModel):
    session: str
    phone: str = ""


class ValidateRequest(BaseModel):
    session: str


def _check_mtproto_key(x_mtproto_key: str) -> None:
    """Reject the request if the shared secret doesn't match."""
    if not MTPROTO_API_KEY or x_mtproto_key != MTPROTO_API_KEY:
        raise HTTPException(status_code=401, detail="unauthorized")


async def get_client(session_string: str, phone: str = "default") -> TelegramClient:
    """Создать или получить из кэша TelegramClient"""
    cache_key = phone or "default"

    if cache_key in clients_cache:
        client = clients_cache[cache_key]
        if client.is_connected():
            return client
        else:
            try:
                await client.connect()
                return client
            except Exception:
                clients_cache.pop(cache_key, None)

    # Создаём новый клиент
    string_session = StringSession(session_string.strip())
    client = TelegramClient(
        string_session,
        API_ID,
        API_HASH,
        connection_retries=3,
        timeout=10000,
        receive_updates=False,
    )

    await client.connect()

    if not await client.is_user_authorized():
        raise Exception("Session не авторизован")

    clients_cache[cache_key] = client
    return client


@app.get("/health")
async def health():
    # Don't leak API_ID — just report service is up.
    return {"ok": True, "service": "mtproto-api"}


@app.post("/getcode")
async def get_code(req: GetCodeRequest, x_mtproto_key: str = Header(default="")):
    """Получить последний код входа из Service Notifications (id 777000)"""
    _check_mtproto_key(x_mtproto_key)
    try:
        client = await get_client(req.session, req.phone)

        # Получаем сообщения от Service Notifications
        messages = await client.get_messages(777000, limit=5)

        if not messages:
            return {"ok": False, "error": "Нет сообщений от Service Notifications"}

        import time
        now = time.time()

        for msg in messages:
            # Проверяем возраст (10 минут максимум)
            msg_time = msg.date.timestamp() if hasattr(msg.date, 'timestamp') else msg.date
            if isinstance(msg_time, (int, float)):
                age = now - msg_time
            else:
                age = 0  # если не можем определить — показываем

            if age > 600:  # 10 минут
                continue

            text = msg.message or ""
            if not text:
                continue

            # Tightened code regex: prefer "login code" / "код" / "code" prefixes,
            # fall back to any 4-8 digit group only if no prefix matched.
            code = None
            m = re.search(r'(?:login code|код|code)[:\s]*(\d{4,8})', text, re.IGNORECASE)
            if m:
                code = m.group(1)
            else:
                m = re.search(r'\b(\d{4,8})\b', text)
                if m:
                    code = m.group(1)

            if code:
                return {
                    "ok": True,
                    "code": code,
                    "text": text[:200],
                    "age_seconds": int(age),
                }

        return {"ok": False, "error": "Код не найден в последних сообщениях. Подождите 30 сек и попробуйте снова."}

    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/validate")
async def validate_session(req: ValidateRequest, x_mtproto_key: str = Header(default="")):
    """Проверить валидность сессии"""
    _check_mtproto_key(x_mtproto_key)
    try:
        client = await get_client(req.session, "validate")
        me = await client.get_me()
        return {
            "ok": True,
            "user_id": me.id,
            "first_name": me.first_name,
            "phone": me.phone,
            "username": me.username,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
# trigger mtproto-api deploy
