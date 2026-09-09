import { viteBackendUrl } from "@/config/viteEnv";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiError = {
  status: number;
  message: string;
  details?: unknown;
};

/**
 * Fired on `window` when the server rejects a credential we actually sent —
 * i.e. the session is over, not merely one request failing.
 *
 * A plain DOM event rather than a direct call so this module stays free of
 * React and the router: AuthContext subscribes and decides what "logged out"
 * means (clear state, show the login screen). Anything else that cares can
 * subscribe too.
 */
export const UNAUTHORIZED_EVENT = "liratek:unauthorized";

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

/**
 * Same-origin API base, used only when the page itself was served over HTTP(S).
 *
 * A deployment that serves the SPA and routes /api from ONE origin (Vercel s
 * Services preset; the nginx front door in docker-compose.yml) needs neither a
 * build-time hostname nor a runtime global -- the API is simply here. That is
 * what lets a single build run on any hostname: preview URLs, the production
 * domain, and per-tenant subdomains, with nothing rebaked.
 *
 * Protocol-guarded deliberately. The Electron renderer loads over file://,
 * where location.origin is the string "null"; it must keep falling through to
 * the local backend default below.
 */
function sameOriginBase(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const { protocol, origin } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return undefined;
  return origin;
}

export function getBaseUrl(): string {
  // Precedence: runtime global override (set by the web e2e fixtures) >
  // build-time env (VITE_BACKEND_URL, set by `yarn dev:web` so the web backend
  // can live off the default port when something else, e.g. a Docker
  // container, squats it) > the page s own origin > the local-dev default.
  const fromGlobal = (globalThis as any).__LIRATEK_BACKEND_URL as
    | string
    | undefined;
  // 127.0.0.1 (not localhost): browsers may resolve localhost to IPv6 ::1,
  // where another process (e.g. Docker) can be listening on the same port.
  return (
    fromGlobal ||
    viteBackendUrl ||
    sameOriginBase() ||
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
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

  // Remembered so a 401 can tell "the server rejected OUR credential" from
  // "we never sent one", AND so a late 401 belonging to an OLD session cannot
  // discard a newer one — see the !res.ok branch below.
  let sentToken: string | null = null;
  if (options?.auth !== false) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      sentToken = token;
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : null,
  });

  // Sliding session: the backend re-issues a nearly-expired JWT on any
  // authenticated request and returns it here. Swapping it in keeps an active
  // user signed in past the token lifetime -- the DB session already slid, the
  // JWT exp did not, so day 7 logged people out despite a healthy session.
  //
  // Only replaces the NORMAL login token. An impersonation session lives in
  // sessionStorage and is per-tab on purpose; overwriting localStorage from an
  // impersonated request would leak that session into every other tab.
  //
  // `headers?.` is not paranoia about the real fetch — it is about the many
  // fetch DOUBLES this file runs against. A stub that returns
  // `{ ok, text }` and nothing else is the normal way the dual-mode tests
  // assert routing, and reading `.get` off it threw a TypeError that surfaced
  // as five unrelated suites failing inside requestJson. Renewal itself is
  // proven by backend/src/middleware/__tests__/tokenRenewal.test.ts against
  // real headers; nothing here needs a header to be present.
  const renewed = res.headers?.get("X-Renewed-Token");
  if (renewed && !getImpersonationToken()) setToken(renewed);

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // A rejected session must END the session, not just fail one request.
    //
    // Without this the app kept its `user` state after the server stopped
    // accepting the token, so every subsequent call 401'd against a fully
    // rendered dashboard and the login screen was never shown. Seen for real
    // when the Reset Data feature wiped `sessions`: the token's row was gone,
    // and the UI carried on as though signed in.
    //
    // Guards, each load-bearing:
    //   `auth !== false`      — the LOGIN request is unauthenticated; a 401
    //                           there means a wrong password and must surface
    //                           as such.
    //   `sentToken`           — if no credential was sent, this 401 says
    //                           nothing about our session, and firing on every
    //                           anonymous call would loop.
    //   still the same token  — THE STALE-401 RACE. A page holding a dead
    //                           token fires a dozen dashboard requests; the
    //                           user signs in while they are in flight; then
    //                           those 401s land and, without this check, wipe
    //                           the brand-new token and sign the user straight
    //                           back out. Observed exactly that way: log in,
    //                           reach the dashboard, immediately bounced with
    //                           "Session expired". A 401 only condemns the
    //                           session it was sent with.
    // Notifying rather than redirecting keeps this file free of React and the
    // router; AuthContext owns what "logged out" means.
    if (
      res.status === 401 &&
      options?.auth !== false &&
      sentToken &&
      getToken() === sentToken
    ) {
      setToken(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
      }
    }

    const err: ApiError = {
      status: res.status,
      message: data?.error || data?.message || `Request failed (${res.status})`,
      details: data,
    };
    throw err;
  }

  return data as T;
}
