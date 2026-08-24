const TOKEN_KEY = "fm_pg_token";
const USER_KEY = "fm_pg_user";

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

export function setAuth(token: string, user: unknown) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function readStoredUser<T>() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) || "null") as T | null;
  } catch {
    return null;
  }
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error("Cannot reach the counselor API. Keep it running on port 8787 and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}
