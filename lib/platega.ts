// Platega.io payment integration
// Docs: https://docs.platega.io
// Auth: X-MerchantId + X-Secret headers
// Create invoice: POST https://app.platega.io/v2/transaction/process
// Check status:   GET https://app.platega.io/transaction/{id}
// Webhook:        Platega → our /api/platega/webhook with X-MerchantId + X-Secret headers

const PLATEGA_API = "https://app.platega.io";
const MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID || "";
const SECRET = process.env.PLATEGA_SECRET || "";

if (!MERCHANT_ID || !SECRET) {
  console.warn("[platega] WARNING: PLATEGA_MERCHANT_ID or PLATEGA_SECRET env var not set — payments will fail");
}

export interface PlategaCreateResponse {
  transactionId: string;
  status: string; // PENDING
  url: string; // payment page URL
  expiresIn: string; // "00:15:00"
  rate: number;
}

export interface PlategaStatusResponse {
  id: string;
  status: "PENDING" | "CONFIRMED" | "CANCELED" | "CHARGEBACKED";
  paymentDetails: { amount: number; currency: string };
  paymentMethod?: string;
  payload?: string;
}

function authHeaders() {
  return {
    "X-MerchantId": MERCHANT_ID,
    "X-Secret": SECRET,
    "Content-Type": "application/json",
  };
}

/**
 * Create a Platega payment transaction.
 * Returns the payment URL the user should be redirected to.
 */
export async function createPayment(opts: {
  amount: number;
  currency?: string;
  description: string;
  returnUrl: string;
  failUrl: string;
  payload: string; // order id — we get it back in webhook
  userId?: string; // telegram id (for antifraud)
  userName?: string; // telegram username
}): Promise<{ ok: true; data: PlategaCreateResponse } | { ok: false; error: string }> {
  if (!MERCHANT_ID || !SECRET) {
    return { ok: false, error: "Platega not configured (PLATEGA_MERCHANT_ID / PLATEGA_SECRET missing)" };
  }
  try {
    const body: any = {
      paymentDetails: {
        amount: Math.round(opts.amount), // Platega expects integer (kopecks or whole RUB)
        currency: opts.currency || "RUB",
      },
      description: opts.description.slice(0, 200),
      return: opts.returnUrl,
      failedUrl: opts.failUrl,
      payload: opts.payload,
    };
    if (opts.userId) {
      body.metadata = {
        userId: String(opts.userId),
        userName: opts.userName || "",
      };
    }

    const res = await fetch(`${PLATEGA_API}/v2/transaction/process`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    console.log("[platega] createPayment status", res.status, "body:", text.slice(0, 300));
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(text); msg = j.message || j.error || msg; } catch {}
      return { ok: false, error: msg };
    }
    const data = JSON.parse(text) as PlategaCreateResponse;
    if (!data.url || !data.transactionId) {
      return { ok: false, error: "Platega response missing url/transactionId: " + text.slice(0, 200) };
    }
    return { ok: true, data };
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, error: "Таймаут — Platega не ответил за 20 сек" };
    }
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Check transaction status by id.
 */
export async function getStatus(transactionId: string): Promise<{ ok: true; data: PlategaStatusResponse } | { ok: false; error: string }> {
  if (!MERCHANT_ID || !SECRET) {
    return { ok: false, error: "Platega not configured" };
  }
  try {
    const res = await fetch(`${PLATEGA_API}/transaction/${transactionId}`, {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 150)}` };
    }
    const data = JSON.parse(text) as PlategaStatusResponse;
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Validate that a webhook request is genuinely from Platega.
 * Platega sends X-MerchantId + X-Secret headers — we compare to our env.
 */
export function validateWebhookHeaders(req: Request): boolean {
  const merchantId = req.headers.get("x-merchantid") || "";
  const secret = req.headers.get("x-secret") || "";
  if (!MERCHANT_ID || !SECRET) return false;
  // Constant-time-ish compare
  return merchantId === MERCHANT_ID && secret === SECRET;
}

/**
 * Cancel/refund a transaction (if supported).
 */
export async function cancelTransaction(transactionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!MERCHANT_ID || !SECRET) {
    return { ok: false, error: "Platega not configured" };
  }
  try {
    const res = await fetch(`${PLATEGA_API}/v2/transaction/${transactionId}/cancel`, {
      method: "POST",
      headers: authHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 150)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
