// Tiny fetch wrapper used across client components
async function request<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  })
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // FIX 14: surface the raw text on parse failure instead of throwing a
      // confusing "Unexpected token" SyntaxError.
      throw new Error("HTTP " + res.status + ": " + text.slice(0, 200))
    }
  }
  if (!res.ok) {
    const msg = data?.error || `Ошибка ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export const api = {
  get: <T = any>(url: string) => request<T>(url),
  post: <T = any>(url: string, body?: any) =>
    request<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T = any>(url: string, body?: any) =>
    request<T>(url, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(url: string) => request<T>(url, { method: "DELETE" }),
}

// alias kept for compatibility
export const db_client = api
