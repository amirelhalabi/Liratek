import { localDay } from "@liratek/core/utils/localDate";

import { getShop, getToken, setToken } from "@/auth/tokenStore";

/**
 * The phone talks to the API host directly (not a shop subdomain); the shop
 * comes from the JWT after sign-in. Set per environment like hetivo-mobile-driver.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.liratek.shop";

/**
 * DEVELOPMENT ONLY. "shop-host" sends every request to
 * https://<shop>.liratek.shop, where the deployed server recognises the shop
 * from the address exactly as it does for the web app, so the EXISTING web
 * login works before the phone's own sign-in route is deployed. Ignored in
 * release builds.
 */
export const SHOP_HOST_MODE = __DEV__ && process.env.EXPO_PUBLIC_API_MODE === "shop-host";

export function shopHostUrl(slug: string): string {
  return `https://${encodeURIComponent(slug.trim().toLowerCase())}.liratek.shop`;
}

async function resolveBaseUrl(override?: string): Promise<string> {
  if (override) return override;
  if (SHOP_HOST_MODE) {
    const shop = await getShop();
    if (shop) return shopHostUrl(shop.slug);
  }
  return API_BASE_URL;
}

/** Same envelope as IPC and REST: `{ success, data?, error? }`. */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export const NO_CONNECTION = "NO_CONNECTION";
export const UNAUTHORIZED = "UNAUTHORIZED";

interface RequestOptions {
  body?: unknown;
  /** One key per "Save" tap, reused on retries of that tap (FR-017). */
  idempotencyKey?: string;
  /** Sign-in routes run before a token exists. */
  auth?: boolean;
  /** Absolute base URL for this one call (shop-host sign-in before a shop is stored). */
  baseUrl?: string;
}

let onUnauthorized: (() => void) | null = null;

/** The auth context registers this to send the app back to sign-in on 401. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Errors come as a plain string (IPC-style routes) or `{ code, message }` (createErrorResponse). */
function errorCode(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const e = error as { code?: unknown; message?: unknown };
    if (typeof e.code === "string") return e.code;
    if (typeof e.message === "string") return e.message;
  }
  return null;
}

export async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  let sentToken: string | null = null;
  if (options.auth !== false) {
    sentToken = await getToken();
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
  }
  // Rule 27: the phone supplies its own day and offset, exactly as the web
  // client does (frontend/src/api/httpClient.ts), so server reports bucket a
  // UTC row into the shop's local day.
  headers["X-Client-Day"] = localDay();
  headers["X-Client-Tz-Offset"] = String(-new Date().getTimezoneOffset());
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${await resolveBaseUrl(options.baseUrl)}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
    });
  } catch {
    // No queue and no silent retry: the owner must know it was not saved (FR-018).
    return { success: false, error: NO_CONNECTION };
  }

  // Sliding session: keep the renewed token, but only if it renews the token we sent.
  const renewed = res.headers.get("X-Renewed-Token");
  if (renewed && sentToken && (await getToken()) === sentToken) {
    await setToken(renewed);
  }

  if (res.status === 401 && sentToken) {
    onUnauthorized?.();
    return { success: false, error: UNAUTHORIZED };
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return { success: false, error: `HTTP_${res.status}` };
  }

  // Most routes answer HTTP 200 with the envelope; POST /api/debts/repayments
  // answers 400 with a JSON body, so read the body whatever the status.
  if (parsed !== null && typeof parsed === "object" && "success" in parsed) {
    const env = parsed as { success: boolean; error?: unknown; data?: unknown };
    if (env.success) return { success: true, data: (env.data ?? parsed) as T };
    return { success: false, error: errorCode(env.error) ?? `HTTP_${res.status}` };
  }
  // Read routes return the raw shape (array/object) with no envelope.
  if (res.ok) return { success: true, data: parsed as T };
  return { success: false, error: `HTTP_${res.status}` };
}
