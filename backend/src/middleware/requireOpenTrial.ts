/**
 * LIRA-332 — once a shop's FREE TRIAL has ended, refuse every write from its
 * own users except the few that create no business record. Reads always
 * pass. Nothing is deleted: the shop can sign in, view and export
 * everything, and gets everything back the moment the owner activates or
 * extends it (owner decisions 2026-10-17).
 *
 * ## Why an ALLOWLIST here, when `requireWritableSubscription` is a denylist
 *
 * That gate protects PAYING shops whose payment lapsed: a forgotten trading
 * route must stay writable, because a paying shop must never lose its till
 * (read its module comment). The owner decision for an ended TRIAL is the
 * opposite — "no new records of any kind" — for a shop that never paid. So a
 * forgotten route failing CLOSED is the intended outcome, and the risk is a
 * forgotten read-like POST failing closed. The full route inventory
 * (`specs/332-free-trial/write-inventory.md`, T028/T029) was done BEFORE this
 * list was written; every entry names why it creates no record. Add to it
 * only with the same kind of reason.
 *
 * Mounted in `server.ts` immediately BEFORE `requireWritableSubscription`,
 * so an ended trial always gets the trial wording, never "subscription has
 * lapsed".
 *
 * Refuses with HTTP 200 and the IPC-identical envelope (rule 19c), not the
 * older gate's 402: a non-2xx makes `httpClient` throw an `ApiError` some
 * callers swallow, and the page must show this text where it shows errors.
 *
 * The end is decided by SERVER time against the stored end instant, through
 * `SubscriptionService` (one derivation, explicit Asia/Beirut calendar). The
 * client's `X-Client-Day` is deliberately ignored here: the shop controls
 * that header, so trusting it would let a shop keep its own trial alive
 * (research R3).
 *
 * FAILS OPEN: no tenant (public routes, platform super admins, device-key
 * requests from a paired PC — those are handled in core, research R8), no
 * subscription row, or a thrown lookup all let the write through. A
 * super admin IMPERSONATING an ended shop carries its tenant id and is
 * refused like the shop: the owner extends or activates first.
 */

import type { Request, Response, NextFunction } from "express";
import { getSubscriptionService } from "@liratek/core";
import { resolveRequestTenantId } from "./requestTenant.js";
import { logger } from "../server.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** FR-011: one sentence, used by every refusal site. Never "overdue",
 * "lapsed" or "read-only". */
export const TRIAL_ENDED_MESSAGE =
  "Your free trial has ended. Contact LiraTek on WhatsApp to activate.";

export const TRIAL_ENDED_CODE = "TRIAL_ENDED";

export interface AllowedWrite {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Matched against the lowercased path, query string removed. */
  path: RegExp;
  reason: string;
}

/**
 * Writes an ended-trial shop may still make. See write-inventory.md (T028)
 * for the full classification of every write route.
 */
export const TRIAL_ENDED_ALLOWED_WRITES: readonly AllowedWrite[] = [
  // ── Sign-out and removing access ──────────────────────────────────────
  { method: "POST", path: /^\/api\/auth\/logout\/?$/, reason: "sign-out (web, phone, and the old-token logout at every login)" },
  { method: "POST", path: /^\/api\/auth\/sessions\/revoke-others\/?$/, reason: "signs out other devices (removes access)" },
  { method: "DELETE", path: /^\/api\/auth\/sessions\/\d+\/?$/, reason: "ends one session (removes access)" },
  { method: "DELETE", path: /^\/api\/auth\/google\/link\/?$/, reason: "removes the user's own Google sign-in" },
  { method: "DELETE", path: /^\/api\/user-email\/\d+\/google\/?$/, reason: "admin removes a member's Google sign-in (off-boarding)" },
  { method: "POST", path: /^\/api\/user-invitations\/\d+\/revoke\/?$/, reason: "revokes a pending invite (removes access)" },
  { method: "POST", path: /^\/api\/offline\/devices\/\d+\/revoke\/?$/, reason: "unpairs a PC (removes access)" },
  // ── Account safety: the user's own password and email (owner decision) ─
  { method: "POST", path: /^\/api\/password-reset\/change\/?$/, reason: "own password" },
  { method: "POST", path: /^\/api\/password-reset\/set-initial\/?$/, reason: "own first password (needed before unlinking Google)" },
  { method: "POST", path: /^\/api\/user-email\/me\/change\/?$/, reason: "own email" },
  { method: "POST", path: /^\/api\/user-email\/verify\/?$/, reason: "completes an own-email change (public token route)" },
  // ── View and export (POSTs that read) ─────────────────────────────────
  { method: "POST", path: /^\/api\/profits\/(unlock|lock)\/?$/, reason: "view gate for Profits; in-memory grant, no DB write" },
  { method: "POST", path: /^\/api\/audit\/search\/?$/, reason: "view: audit log search (read)" },
  { method: "POST", path: /^\/api\/reports\/pdf\/?$/, reason: "export" },
  { method: "POST", path: /^\/api\/reports\/backup\/verify\/?$/, reason: "verifies a backup file; no write" },
  { method: "POST", path: /^\/api\/vouchers\/validate\/?$/, reason: "view: looks a voucher code up (one SELECT)" },
  { method: "POST", path: /^\/api\/exchange-lots\/preview\/?$/, reason: "view: FIFO dry run" },
  { method: "POST", path: /^\/api\/product-units\/(list|summary|for-sale-items)\/?$/, reason: "view: phone units (read)" },
  // ── Public routes (normally no bearer; listed so a stale header can never
  //    block signing in). Invite accept still cannot add a user to an
  //    ended shop: UserInvitationService refuses it.
  { method: "POST", path: /^\/api\/auth\/(login|signup|signup\/request|signup\/invite\/check)\/?$/, reason: "public sign-in / sign-up" },
  { method: "POST", path: /^\/api\/auth\/signin-code\/(request|verify)\/?$/, reason: "public sign-in code" },
  { method: "POST", path: /^\/api\/auth\/google\/(start|choose|sso-exchange)\/?$/, reason: "public Google sign-in" },
  { method: "POST", path: /^\/api\/mobile\/auth\/login\/?$/, reason: "public phone sign-in" },
  { method: "POST", path: /^\/api\/password-reset\/(forgot|check|reset)\/?$/, reason: "public password reset" },
  { method: "POST", path: /^\/api\/user-invitations\/(check|accept|google\/start)\/?$/, reason: "public invite link (accept refused in core for an ended shop)" },
  { method: "POST", path: /^\/api\/offline\/pair\/?$/, reason: "pairing a PC is configuration, allowed after the end (owner decision)" },
];

/** Lowercased path without the query string (Express routes ignore case). */
function normalisedPath(originalUrl: string): string {
  return (originalUrl.split("?")[0] ?? "").toLowerCase();
}

export function isTrialEndedAllowedWrite(
  method: string,
  originalUrl: string,
): boolean {
  const path = normalisedPath(originalUrl);
  return TRIAL_ENDED_ALLOWED_WRITES.some(
    (w) => w.method === method && w.path.test(path),
  );
}

/** The refusal body, shared by every gate that answers an ended trial. */
export function trialEndedBody() {
  return {
    success: false as const,
    error: TRIAL_ENDED_MESSAGE,
    code: TRIAL_ENDED_CODE,
  };
}

export function requireOpenTrial(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!WRITE_METHODS.has(req.method)) return next();

  const tenantId = resolveRequestTenantId(req);
  if (tenantId === null) return next();

  if (isTrialEndedAllowedWrite(req.method, req.originalUrl)) return next();

  let ended = false;
  try {
    ended = getSubscriptionService().statusFor(tenantId)?.standing === "trial_ended";
  } catch (error) {
    logger.error(
      { error, tenantId },
      "trial check failed; allowing the write",
    );
    return next();
  }
  if (!ended) return next();

  logger.warn(
    { tenantId, method: req.method, path: req.originalUrl },
    "write refused: free trial has ended",
  );
  res.status(200).json(trialEndedBody());
}
