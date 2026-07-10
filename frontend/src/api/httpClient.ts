type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiError = {
  status: number;
  message: string;
  details?: unknown;
};

// ── Storage keys ────────────────────────────────────────────────────────────
// liratek.jwt          — localStorage, the normal (non-impersonation) login
//                         session. Shared across every tab of this origin.
// liratek.impersonation — sessionStorage, per-tab. Set only in a tab opened
//                         via the super admin's "Connect as admin" handoff
//                         (?impersonation_token=... -> bootstrapped here).
//                         Being per-tab is the whole point: the super admin's
//                         own tab keeps its own session in localStorage while
//                         the impersonation tab acts as the tenant, and the
//                         two never collide.
const JWT_STORAGE_KEY = "liratek.jwt";
const IMPERSONATION_TOKEN_KEY = "liratek.impersonation";
const IMPERSONATION_TENANT_NAME_KEY = "liratek.impersonation_tenant";
const IMPERSONATION_USERNAME_KEY = "liratek.impersonation_username";

function getBaseUrl(): string {
  // Prefer runtime override (works in both Vite and Jest typecheck)
  const fromGlobal = (globalThis as any).__LIRATEK_BACKEND_URL as
    | string
    | undefined;
  // 127.0.0.1 (not localhost): browsers may resolve localhost to IPv6 ::1,
  // where another process (e.g. Docker) can be listening on the same port.
  return (fromGlobal || "http://127.0.0.1:3000").replace(/\/$/, "");
}

/**
 * Token precedence: an active impersonation session (sessionStorage, per-tab)
 * always wins over the normal login session (localStorage, shared across
 * tabs). This is what makes the two-tab impersonation handoff work — the tab
 * that received `?impersonation_token=` acts as the tenant admin for every
 * request, while the super admin's original tab is untouched.
 */
export function getToken(): string | null {
  return (
    sessionStorage.getItem(IMPERSONATION_TOKEN_KEY) ??
    localStorage.getItem(JWT_STORAGE_KEY)
  );
}

/** Normal login session (localStorage) — untouched by impersonation. */
export function setToken(token: string | null): void {
  if (!token) {
    localStorage.removeItem(JWT_STORAGE_KEY);
    return;
  }
  localStorage.setItem(JWT_STORAGE_KEY, token);
}

export function clearToken(): void {
  setToken(null);
}

// ── Impersonation session (sessionStorage, per-tab) ─────────────────────────

export function getImpersonationToken(): string | null {
  return sessionStorage.getItem(IMPERSONATION_TOKEN_KEY);
}

export function setImpersonationToken(token: string): void {
  sessionStorage.setItem(IMPERSONATION_TOKEN_KEY, token);
}

export function clearImpersonationToken(): void {
  sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY);
}

export function isImpersonationActive(): boolean {
  return getImpersonationToken() !== null;
}

/**
 * The impersonation JWT (plan §3) only carries
 * {userId, role, sessionToken, tenantId, impersonatorId?} — no tenant name,
 * no username. Both travel out-of-band: appended to the `window.open` handoff
 * URL by the super admin's tab (which has them from the impersonate response)
 * and stashed here by the bootstrap parser in the new tab.
 */
export function getImpersonationTenantName(): string | null {
  return sessionStorage.getItem(IMPERSONATION_TENANT_NAME_KEY);
}

export function setImpersonationTenantName(name: string): void {
  sessionStorage.setItem(IMPERSONATION_TENANT_NAME_KEY, name);
}

export function getImpersonationUsername(): string | null {
  return sessionStorage.getItem(IMPERSONATION_USERNAME_KEY);
}

export function setImpersonationUsername(username: string): void {
  sessionStorage.setItem(IMPERSONATION_USERNAME_KEY, username);
}

/** Clears the whole impersonation session — used on Disconnect/logout. */
export function clearImpersonationSession(): void {
  sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY);
  sessionStorage.removeItem(IMPERSONATION_TENANT_NAME_KEY);
  sessionStorage.removeItem(IMPERSONATION_USERNAME_KEY);
}

export async function requestJson<T>(
  path: string,
  options?: {
    method?: HttpMethod;
    body?: unknown;
    auth?: boolean;
  },
): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const method = options?.method ?? "GET";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options?.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : null,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message: data?.error || data?.message || `Request failed (${res.status})`,
      details: data,
    };
    throw err;
  }

  return data as T;
}
