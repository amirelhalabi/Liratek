/**
 * Cloudflare Turnstile server-side verification (LIRA-267, T050).
 *
 * The public "email me a sign-up link" form carries a Turnstile token; this
 * asks Cloudflare whether it is genuine. The answer is a TRI-STATE, not a
 * boolean, because contracts/api.md tells the visitor two different things:
 *
 *   passed       Cloudflare said `success: true`.
 *   rejected     Cloudflare refused the visitor's token
 *                -> "Please complete the check and try again."
 *   unavailable  we could not get an answer we can trust: network error,
 *                5-second timeout, non-2xx, unparsable body, or Cloudflare
 *                rejecting OUR secret (a server misconfiguration is not the
 *                visitor's fault) -> "Please try again in a few minutes."
 *
 * Both non-passed outcomes fail CLOSED: nothing is sent.
 */

import {
  TURNSTILE_SECRET_KEY,
  TURNSTILE_SITE_KEY,
  authLogger,
} from "@liratek/core";

export type TurnstileOutcome = "passed" | "rejected" | "unavailable";

/** The slice of `fetch` this module needs; injectable for tests. */
export type TurnstileFetch = (
  url: string,
  init: { method: string; body: URLSearchParams; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface VerifyTurnstileOptions {
  /** Defaults to TURNSTILE_SECRET_KEY. */
  secret?: string;
  /** Defaults to the global `fetch`. */
  fetchImpl?: TurnstileFetch;
  /** Defaults to TURNSTILE_TIMEOUT_MS. */
  timeoutMs?: number;
}

export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_TIMEOUT_MS = 5000;

/** Error codes that mean OUR configuration is wrong, not the visitor's
 * token (Cloudflare siteverify error codes). */
const SERVER_SIDE_ERROR_CODES = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "internal-error",
]);

/** True when both the public site key and the secret are set. */
export function isTurnstileConfigured(
  siteKey: string | undefined = TURNSTILE_SITE_KEY,
  secret: string | undefined = TURNSTILE_SECRET_KEY,
): boolean {
  return Boolean(siteKey) && Boolean(secret);
}

const globalFetch: TurnstileFetch = (url, init) => fetch(url, init);

function errorCodes(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const codes = (body as { "error-codes"?: unknown })["error-codes"];
  return Array.isArray(codes)
    ? codes.filter((c): c is string => typeof c === "string")
    : [];
}

export async function verifyTurnstile(
  token: string,
  ip: string | undefined,
  options: VerifyTurnstileOptions = {},
): Promise<TurnstileOutcome> {
  const secret = options.secret ?? TURNSTILE_SECRET_KEY;
  if (!secret) {
    authLogger.error("Turnstile verification skipped: no secret configured");
    return "unavailable";
  }
  const fetchImpl = options.fetchImpl ?? globalFetch;

  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? TURNSTILE_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      authLogger.warn(
        { status: response.status },
        "Turnstile siteverify answered non-2xx",
      );
      return "unavailable";
    }
    const body = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      (body as { success?: unknown }).success === true
    ) {
      return "passed";
    }
    const codes = errorCodes(body);
    if (codes.some((code) => SERVER_SIDE_ERROR_CODES.has(code))) {
      authLogger.error(
        { errorCodes: codes },
        "Turnstile rejected the server's own configuration",
      );
      return "unavailable";
    }
    return "rejected";
  } catch (error) {
    authLogger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Turnstile siteverify unreachable or timed out",
    );
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}
