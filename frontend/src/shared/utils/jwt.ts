/**
 * Client-side JWT payload decoding — UI-trust only.
 *
 * This does NOT verify the signature; it is purely for reading claims to
 * drive UI decisions (which realm to route into, what to show in a banner).
 * The server independently verifies + enforces every claim on every request
 * (see backend/src/middleware/auth.ts) — a forged/altered payload here can,
 * at worst, mis-route the UI locally; it can never grant real access.
 */
export interface JwtPayload {
  userId?: number;
  role?: string;
  tenantId?: number | null;
  impersonatorId?: number;
  sessionToken?: string;
  /** Not part of the documented JWT contract (plan §3) — decoded defensively
   * in case the backend adds it; callers should not assume it is present. */
  username?: string;
  [key: string]: unknown;
}

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  // atob() returns a binary string (one byte per char code) — re-encode as
  // percent-escapes and decodeURIComponent to correctly recover UTF-8 text.
  let percentEncoded = "";
  for (let i = 0; i < binary.length; i++) {
    const hex = binary.charCodeAt(i).toString(16).padStart(2, "0");
    percentEncoded += "%" + hex;
  }
  return decodeURIComponent(percentEncoded);
}

/**
 * Decodes the middle (payload) segment of a JWT. Returns null for anything
 * malformed rather than throwing — callers treat a decode failure the same
 * as "no claims available" and fall back accordingly.
 */
export function decodeJwtPayload<T extends object = JwtPayload>(
  token: string | null | undefined,
): T | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = base64UrlDecode(parts[1]);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
