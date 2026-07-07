// SMS Numbers модуль — интеграция с smsfast.vip (sms-activate совместимый API)
const SMS_API = "https://backend.smsfast.vip/stubs/handler_api.php";
const SMS_KEY = process.env.SMS_API_KEY || "***REDACTED_SMS_KEY***";

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
  const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getBalance`);
  const text = await res.text();
  if (text.startsWith("ACCESS_BALANCE:")) {
    return parseFloat(text.split(":")[1]);
  }
  throw new Error(text);
}

export async function orderNumber(service: string, country: number): Promise<{ id: number; phone: string }> {
  console.log("[SMS] orderNumber:", { service, country });
  const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getNumber&service=${service}&country=${country}`);
  const text = await res.text();
  console.log("[SMS] orderNumber response:", text);
  
  if (text.startsWith("ACCESS_NUMBER:")) {
    const parts = text.split(":");
    return { id: parseInt(parts[1]), phone: "+" + parts[2] };
  }
  if (text === "NO_NUMBERS") throw new Error("Нет доступных номеров для этой страны. Попробуйте другую.");
  if (text === "NO_BALANCE") throw new Error("Недостаточно средств на балансе сервиса.");
  throw new Error("Ошибка заказа номера: " + text);
}

export async function getStatus(id: number): Promise<{ status: string; code?: string }> {
  const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getStatus&id=${id}`);
  const text = await res.text();
  if (text.startsWith("STATUS_OK:")) {
    return { status: "ok", code: text.split(":")[1] };
  }
  if (text === "STATUS_WAIT_CODE") return { status: "wait" };
  if (text === "STATUS_CANCEL") return { status: "cancel" };
  return { status: text };
}

export async function setStatus(id: number, status: number): Promise<string> {
  // 1 = готов, 3 = запросить ещё код, 6 = завершить, 8 = отменить
  const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=setStatus&id=${id}&status=${status}`);
  return await res.text();
}

export async function getActiveActivations(): Promise<any[]> {
  const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getActiveActivations`);
  const text = await res.text();
  if (text === "NO_ACTIVATIONS") return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}
