import asyncio
import json
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from telethon import TelegramClient
from telethon.sessions import StringSession

app = FastAPI(title="MTProto API", version="1.0.0")

# CORS — разрешаем запросы от бота
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_ID = int(os.environ.get("TG_API_ID", "2040"))
API_HASH = os.environ.get("TG_API_HASH", "b18441a1ff607e10a989891a5462e627")
PORT = int(os.environ.get("PORT", "8080"))

# Кэш клиентов: phone → TelegramClient
clients_cache = {}


class GetCodeRequest(BaseModel):
    session: str
    phone: str = ""


class ValidateRequest(BaseModel):
    session: str


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
            except:
                del clients_cache[cache_key]
    
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
    return {"ok": True, "service": "mtproto-api", "api_id": API_ID}


@app.post("/getcode")
async def get_code(req: GetCodeRequest):
    """Получить последний код входа из Service Notifications (id 777000)"""
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
            
            # Ищем код: обычно 5-6 цифр
            import re
            code_match = re.search(r'(\d{4,6})', text)
            if code_match:
                code = code_match.group(1)
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
async def validate_session(req: ValidateRequest):
    """Проверить валидность сессии"""
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


@app.on_event("shutdown")
async def shutdown():
    """Закрыть все подключения"""
    for client in clients_cache.values():
        try:
            await client.disconnect()
        except:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
# trigger mtproto-api deploy
