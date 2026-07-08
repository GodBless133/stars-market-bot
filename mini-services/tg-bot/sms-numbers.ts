// SMS Numbers модуль — интеграция с smsfast.vip (sms-activate совместимый API)
// NOTE: this file is currently dead code (the bot uses the inline SMS helpers in index.ts),
// but kept for consistency. Secrets come from env — no hardcoded defaults.
const SMS_API = "https://backend.smsfast.vip/stubs/handler_api.php";
const SMS_KEY = process.env.SMS_API_KEY || "";
if (!SMS_KEY) console.warn("[sms-numbers] WARNING: SMS_API_KEY env var not set — functions will throw");

// Маппинг стран: название → ID для smsfast.vip handler_api
// ВАЖНО: ID разные для REST API и handler_api!
// handler_api: 115=США, 6=Индонезия, 34=Канада, 16=Великобритания, 36=Канада(alt), 93=Португалия
export const SMS_COUNTRIES: Record<string, { id: number; name: string }> = {
  "usa": { id: 115, name: "США" },
  "usa-virtual": { id: 12, name: "США (виртуальные)" },
  "canada": { id: 34, name: "Канада" },
  "portugal": { id: 93, name: "Португалия" },
  "uk": { id: 16, name: "Великобритания" },
  "indonesia": { id: 6, name: "Индонезия" },
};

export async function getBalance(): Promise<number> {
  if (!SMS_KEY) throw new Error("SMS_API_KEY not configured");
  try {
    // FIX 4: 15s timeout — if smsfast hangs, don't hang the caller.
    const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getBalance`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (text.startsWith("ACCESS_BALANCE:")) {
      const bal = parseFloat(text.split(":")[1]);
      if (!Number.isFinite(bal)) throw new Error("Invalid balance response: " + text);
      return bal;
    }
    throw new Error(text);
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("Таймаут — сервис номеров не ответил за 15 сек");
    }
    throw e;
  }
}

export async function orderNumber(service: string, country: number): Promise<{ id: number; phone: string }> {
  if (!SMS_KEY) throw new Error("SMS_API_KEY not configured");
  console.log("[SMS] orderNumber:", { service, country });
  try {
    // FIX 4: 15s timeout — if smsfast hangs, don't hang the caller.
    const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getNumber&service=${service}&country=${country}`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    console.log("[SMS] orderNumber response:", text);

    if (text.startsWith("ACCESS_NUMBER:")) {
      const parts = text.split(":");
      const id = parseInt(parts[1]);
      if (!Number.isFinite(id) || !parts[2]) throw new Error("Invalid number response: " + text);
      return { id, phone: "+" + parts[2] };
    }
    if (text === "NO_NUMBERS") throw new Error("Нет доступных номеров для этой страны. Попробуйте другую.");
    if (text === "NO_BALANCE") throw new Error("Недостаточно средств на балансе сервиса.");
    throw new Error("Ошибка заказа номера: " + text);
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("Таймаут — сервис номеров не ответил за 15 сек");
    }
    throw e;
  }
}

export async function getStatus(id: number): Promise<{ status: string; code?: string }> {
  try {
    // FIX 4: 15s timeout — if smsfast hangs, don't hang the poll loop.
    const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getStatus&id=${id}`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (text.startsWith("STATUS_OK:")) {
      return { status: "ok", code: text.split(":")[1] };
    }
    if (text === "STATUS_WAIT_CODE") return { status: "wait" };
    if (text === "STATUS_CANCEL") return { status: "cancel" };
    return { status: text };
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("Таймаут — сервис номеров не ответил за 15 сек");
    }
    throw e;
  }
}

export async function setStatus(id: number, status: number): Promise<string> {
  // 1 = готов, 3 = запросить ещё код, 6 = завершить, 8 = отменить
  try {
    // FIX 4: 15s timeout — if smsfast hangs, don't hang the caller.
    const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=setStatus&id=${id}&status=${status}`, { signal: AbortSignal.timeout(15000) });
    return await res.text();
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("Таймаут — сервис номеров не ответил за 15 сек");
    }
    throw e;
  }
}

export async function getActiveActivations(): Promise<any[]> {
  try {
    // FIX 4: 15s timeout — if smsfast hangs, don't hang the caller.
    const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getActiveActivations`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (text === "NO_ACTIVATIONS") return [];
    try {
      const data = JSON.parse(text);
      return Array.isArray(data) ? data : [data];
    } catch {
      return [];
    }
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      console.error("[sms-numbers] getActiveActivations timeout:", e?.message || e);
    } else {
      console.error("[sms-numbers] getActiveActivations error:", e?.message || e);
    }
    return [];
  }
}
