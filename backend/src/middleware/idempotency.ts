/**
 * Idempotency-Key handling for money write routes (LIRA-289 FR-017, T011).
 *
 * The phone app sends one key per "Save" tap and reuses it when it retries
 * that tap, so a double tap or a weak-signal retry books the sale once. The
 * rules live in core's IdempotencyService (rule 13); this file only reads the
 * header and scopes the key to the signed-in user and the route. Requests
 * without the header behave exactly as before.
 */
import type { Request } from "express";
import { getIdempotencyService, type IdempotentOutcome } from "@liratek/core";
import type { AuthRequest } from "./auth.js";

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const INVALID_IDEMPOTENCY_KEY = "INVALID_IDEMPOTENCY_KEY";

/** The header's key; null when absent; "invalid" when present but malformed. */
export function readIdempotencyKey(req: Request): string | null | "invalid" {
  const raw = req.headers[IDEMPOTENCY_HEADER];
  if (raw === undefined) return null;
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || !getIdempotencyService().isValidKey(key)) return "invalid";
  return key;
}

/**
 * Runs `book` once per (user, route, key). Without a key it just runs
 * `book`. The caller handles an "invalid" key before calling this.
 */
export function runIdempotent<T extends { success: boolean }>(
  req: Request,
  route: string,
  key: string | null,
  book: () => T,
): IdempotentOutcome<T> {
  if (key === null) return { replayed: false, result: book() };
  const userId = (req as AuthRequest).user!.userId;
  return getIdempotencyService().run(
    { userId, route, key },
    new Date().toISOString(),
    book,
  );
}
