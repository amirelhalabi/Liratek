/**
 * Idempotency-Key handling for money write routes (LIRA-289 FR-017, T011).
 *
 * The phone app sends one key per "Save" tap and reuses it when it retries
 * that tap, so a double tap or a weak-signal retry books the sale once. The
 * rules live in core's IdempotencyService (rule 13); this file only reads the
 * header and scopes the key to the signed-in user and the route. Requests
 * without the header behave exactly as before.
 */
import type { Request, Response } from "express";
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

/**
 * LIRA-401 — the scope a key is remembered under, the same for every guarded
 * route:
 *
 *   `<METHOD> <mount path><route pattern>` — e.g. "POST /api/debts/repayments",
 *   exactly the strings the first two guarded routes (LIRA-289) stored, so
 *   replies saved before this change still replay;
 *
 *   plus, when the route has URL params, their concrete values sorted by name:
 *   "POST /api/sales/:id/refund id=42". The same key on sale 42 and sale 43 is
 *   therefore two submissions, never a replay of the other sale's reply.
 *
 * Built from the route PATTERN (`req.route.path`), not the raw URL, so a
 * trailing slash, `%`-encoding or a query string cannot split one submission
 * into two scopes. A router-root route ("/") drops its slash:
 * "POST /api/expenses", "POST /api/vouchers", "POST /api/custom-services".
 */
export function idempotencyRoute(req: Request): string {
  const routePath: unknown = (req.route as { path?: unknown } | undefined)
    ?.path;
  const pattern = typeof routePath === "string" ? routePath : req.path;
  let route = `${req.method} ${req.baseUrl}${pattern === "/" ? "" : pattern}`;
  const params = req.params ?? {};
  const names = Object.keys(params).sort();
  if (names.length > 0) {
    route += ` ${names.map((n) => `${n}=${String(params[n])}`).join("&")}`;
  }
  return route;
}

function refuseInvalidKey(res: Response): void {
  // HTTP 200 envelope (rule 19c), same as the LIRA-289 routes always did.
  res.json({ success: false, error: INVALID_IDEMPOTENCY_KEY });
}

/**
 * LIRA-401 — the guard every money POST goes through. Reads the
 * Idempotency-Key, answers a malformed one itself (and returns null), else
 * runs `book` at most once per (user, `idempotencyRoute(req)`, key) and hands
 * back `{ replayed, result }`. No header → `book` just runs, as before.
 *
 * `book` must hold the WHOLE booking — anything that writes or depends on
 * state the booking changes (e.g. "already refunded") goes inside it, so a
 * replay answers with the first reply instead of re-checking. Side effects
 * the route performs afterwards (audit, socket events) must be skipped when
 * `replayed` is true. A throw from `book` rolls back and propagates to the
 * route's own catch, so error replies are unchanged. Only a reply with
 * `success: true` is stored; a refusal is re-run on retry.
 */
export function guardIdempotent<T extends { success: boolean }>(
  req: Request,
  res: Response,
  book: () => T,
): IdempotentOutcome<T> | null {
  const key = readIdempotencyKey(req);
  if (key === "invalid") {
    refuseInvalidKey(res);
    return null;
  }
  return runIdempotent(req, idempotencyRoute(req), key, book);
}

/**
 * `guardIdempotent` for a booking that awaits (session / recharge-basket
 * checkout, session close / link). Uses the service's in-flight slot, since a
 * SQLite transaction cannot span an `await` — see IdempotencyService.runAsync.
 */
export async function guardIdempotentAsync<T extends { success: boolean }>(
  req: Request,
  res: Response,
  book: () => Promise<T>,
): Promise<IdempotentOutcome<T> | null> {
  const key = readIdempotencyKey(req);
  if (key === "invalid") {
    refuseInvalidKey(res);
    return null;
  }
  if (key === null) return { replayed: false, result: await book() };
  const userId = (req as AuthRequest).user!.userId;
  return getIdempotencyService().runAsync(
    { userId, route: idempotencyRoute(req), key },
    new Date().toISOString(),
    book,
  );
}

/**
 * The success member of a reply type: for a union like
 * `{ success: true; data } | { success: false; error }` it is the first
 * member (so `onBooked` can read `result.data` without re-checking); for a
 * plain `{ success: boolean; … }` it is the type itself.
 */
export type BookedReply<T> = [Extract<T, { success: true }>] extends [never]
  ? T
  : Extract<T, { success: true }>;

export interface SendIdempotentOptions<T> {
  /**
   * Runs once, after a FRESH successful booking (never on a replay, never on
   * a refusal) — the place for `auditRest` and socket events.
   */
  onBooked?: (result: BookedReply<T>) => void;
  /** HTTP status for the reply; default 200 (rule 19c). */
  status?: (result: T) => number;
}

/**
 * The common shape as ONE call: guard, `onBooked` on a fresh success, send
 * the reply (a replay sends the stored first reply, byte for byte).
 */
export function sendIdempotent<T extends { success: boolean }>(
  req: Request,
  res: Response,
  book: () => T,
  options: SendIdempotentOptions<T> = {},
): void {
  const outcome = guardIdempotent(req, res, book);
  if (!outcome) return;
  finish(res, outcome, options);
}

/** `sendIdempotent` for a booking that awaits. */
export async function sendIdempotentAsync<T extends { success: boolean }>(
  req: Request,
  res: Response,
  book: () => Promise<T>,
  options: SendIdempotentOptions<T> = {},
): Promise<void> {
  const outcome = await guardIdempotentAsync(req, res, book);
  if (!outcome) return;
  finish(res, outcome, options);
}

function finish<T extends { success: boolean }>(
  res: Response,
  { replayed, result }: IdempotentOutcome<T>,
  options: SendIdempotentOptions<T>,
): void {
  if (!replayed && result.success) {
    options.onBooked?.(result as BookedReply<T>);
  }
  res.status(options.status ? options.status(result) : 200).json(result);
}
