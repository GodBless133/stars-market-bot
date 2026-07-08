import crypto from "crypto";

/**
 * Validate Telegram WebApp initData (HMAC-SHA256).
 * Returns the validated user id, or null if invalid.
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string
): number | null {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    // Build data_check_string: sorted keys, each as "key=value\n"
    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys
      .map((k) => `${k}=${params.get(k)}`)
      .join("\n");
    // secret_key = HMAC_SHA256("WebAppData", botToken)
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();
    // calculated_hash = HMAC_SHA256(secret_key, data_check_string)
    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");
    // Constant-time compare
    if (calculatedHash.length !== hash.length) return null;
    if (
      !crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(hash))
    ) {
      return null;
    }
    // Parse user
    const userJson = params.get("user");
    if (!userJson) return null;
    const user = JSON.parse(userJson);
    if (typeof user.id !== "number") return null;
    // Check auth_date is within 24h (replay protection)
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
    return user.id;
  } catch {
    return null;
  }
}
