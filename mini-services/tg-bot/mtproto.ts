// MTProto модуль — отправляет HTTP запрос к Python-сервису (Telethon)
// Python-сервис стабильно работает с Telethon, не блокирует бот

const MTPROTO_API_URL = process.env.MTPROTO_API_URL || "http://localhost:8080";
// Shared secret sent as X-MTPROTO-KEY header — must match MTPROTO_API_KEY on the
// mtproto-api service. If unset here, the service will refuse /getcode (fail-closed).
const MTPROTO_API_KEY = process.env.MTPROTO_API_KEY || "";

/**
 * Получить код входа через Python MTProto сервис
 */
export async function getLoginCode(
  sessionData: string,
  cacheKey: string,
  maxAgeSec = 600
): Promise<{ code: string | null; receivedAt: Date | null; error?: string }> {
  try {
    const res = await fetch(`${MTPROTO_API_URL}/getcode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(MTPROTO_API_KEY ? { "X-MTPROTO-KEY": MTPROTO_API_KEY } : {}),
      },
      body: JSON.stringify({
        session: sessionData,
        phone: cacheKey,
      }),
      signal: AbortSignal.timeout(20000), // 20 сек максимум
    });

    const data = await res.json();

    if (data.ok && data.code) {
      return {
        code: data.code,
        receivedAt: new Date(),
      };
    }

    return {
      code: null,
      receivedAt: null,
      error: data.error || "Не удалось получить код",
    };
  } catch (e: any) {
    return {
      code: null,
      receivedAt: null,
      error: `MTProto сервис недоступен: ${e.message}`,
    };
  }
}

/**
 * Закрыть все подключения (no-op — Python сервис управляет подключениями)
 */
export async function closeAllClients(): Promise<void> {}
