/**
 * Block WRITES to ADMINISTRATIVE routes for a tenant whose subscription has
 * lapsed to `read_only`. Trading — sales, payments, drawers, sessions,
 * closing, recharge, exchange, debts, and everything else that rings up
 * money — is NEVER gated by subscription state. A shop that hasn't paid
 * should find the software annoying and diminished, not unable to sell
 * anything (see `docs/plans/todo_plans/DESKTOP_LICENSING_PLAN.md` §1 for the
 * production incident this rewrite fixes).
 *
 * Reads are never blocked either, for a separate reason: a lapsed shop must
 * always be able to see and export its own `debt_ledger` — that is money
 * its customers owe IT, and withholding it turns a late payment into a
 * furious ex-customer whose books you are holding. That is an owner
 * decision (D4: grace → read-only, never a lockout), not an implementation
 * convenience.
 *
 * FAILS OPEN on every uncertainty, for the same reason the desktop check
 * does: the failure that costs a customer money is worse than the one that
 * costs a licence fee. No tenant on the request, no subscription row, or a
 * thrown lookup all let the write through.
 *
 * ## Why this is a DENYLIST, not an allowlist — read before "tidying" it
 *
 * This middleware used to be an ALLOWLIST (`ALWAYS_WRITABLE`): every write
 * was blocked in `read_only` EXCEPT the handful of paths named there. That
 * shape has exactly one failure mode, and it shipped: `/api/sales` was
 * never on the list, so the moment a real tenant's subscription lapsed it
 * could log in, look at yesterday's numbers, and do nothing else — no sale,
 * no payment, no session close. Every future route was un-sellable by
 * default until someone remembered to add it to a list that had no reason
 * to be top of mind while building a feature.
 *
 * Inverted to a DENYLIST (`SUBSCRIPTION_GATED_PREFIXES`), the failure mode
 * flips to the only one worth having: a route nobody remembered to list
 * stays WRITABLE. The cost of forgetting is a shop that keeps trading while
 * owing money — annoying and recoverable — never a dead till. Gate ONLY
 * unambiguous back-office administration; when in doubt, leave a path OFF
 * this list. An under-gated admin route is a minor loophole; an over-gated
 * trading route is the outage this file exists to prevent. Before adding a
 * prefix here, ask "would this stop someone from selling something today?" —
 * if you cannot answer no with certainty, it does not belong on this list.
 */

import type { Request, Response, NextFunction } from "express";
import { getSubscriptionService } from "@liratek/core";
import { verifyJwt } from "./auth.js";
import { logger } from "../server.js";

/** Methods that can change data. Everything else is a read. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Path prefixes whose WRITES are refused with 402 once a subscription
 * reaches `read_only`. Everything NOT listed here stays writable, by
 * construction — see the module doc comment above for why that is the only
 * acceptable failure direction. Matched against the path WITHIN the mounted
 * router plus its mount point (`req.originalUrl`).
 *
 * Every entry was checked against the router it names, not just its name,
 * because a plausible-sounding prefix can still hide a trading write (see
 * the `/api/carrier-lines` exclusion below — that is exactly the mistake
 * this comment exists to prevent someone from making in reverse):
 *
 * - `/api/users` — creating/editing staff accounts.
 * - `/api/settings` — shop configuration (`PUT /:key`, admin-only; reads
 *   stay open to any authenticated role and are never gated regardless).
 * - `/api/modules` — enabling/disabling modules.
 * - `/api/reports/backup`, `/api/reports/restore` — creating and restoring
 *   backups is administration, and restore is destructive. NOT the whole
 *   `/api/reports` prefix: `POST /pdf` is an EXPORT, and this file's own
 *   rule two paragraphs up is that a lapsed shop must always be able to
 *   export its own `debt_ledger`. It is a placeholder on this transport
 *   today, so gating the prefix would be harmless right now and WRONG the
 *   day someone implements it — a trap that would look deliberate.
 * - `/api/database` — the destructive Settings › Reset Data wipe
 *   (`databaseReset.ts`), already admin-gated at the route level too.
 * - `/api/service-providers`, `/api/service-presets`,
 *   `/api/mobile-service-items` — catalogue administration: creating,
 *   editing, archiving, or seeding the templates a sale later reads from.
 *   Verified route-by-route: none of them write a drawer leg or move money.
 * - `/api/currencies` — adding/removing currencies and their module
 *   associations.
 *
 * DELIBERATELY NOT HERE, each for a stated reason — do not "tidy" one of
 * these in just because its name looks similar to an entry above:
 *
 * - `/api/rates` — the LBP rate moves daily in Lebanon; gating it would
 *   stop CORRECT PRICING, which is part of selling, not administration.
 * - `/api/clients` — a client can be attached DURING a sale (rule 11,
 *   client propagation); blocking client creation blocks sales that name a
 *   client.
 * - `/api/inventory`, `/api/product-units`, `/api/item-costs` — stock
 *   movement is part of trading.
 * - `/api/carrier-lines` — almost entirely catalogue admin (create, update,
 *   archive, set-primary, toggle-active), BUT `POST /record-usage` in that
 *   SAME router is a trading money-write (LIRA-145: books a `Line_Usage`
 *   expense and debits the carrier credit drawer), reachable from the
 *   Expenses page during ordinary trading. One path-prefix cannot gate the
 *   admin CRUD without also gating that write, so the whole prefix stays
 *   OFF this list — leaving carrier-line CRUD writable in `read_only` is
 *   strictly preferable to blocking a trading write.
 * - every other money-moving route: sales, transactions, sessions, closing,
 *   drawer-topup, drawer-cashout, debts, recharge, services,
 *   custom-services, exchange, exchange-lots, loto, vouchers, expenses,
 *   maintenance, hold-money, wallet-exchange, partners, suppliers,
 *   payment-methods.
 */
const SUBSCRIPTION_GATED_PREFIXES = [
  "/api/users",
  "/api/settings",
  "/api/modules",
  "/api/reports/backup",
  "/api/reports/restore",
  "/api/database",
  "/api/service-providers",
  "/api/service-presets",
  "/api/mobile-service-items",
  "/api/currencies",
];

function isSubscriptionGated(originalUrl: string): boolean {
  // Compare against the path only — a query string must not smuggle a match
  // and must not prevent one either.
  const path = originalUrl.split("?")[0] ?? "";
  return SUBSCRIPTION_GATED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Which tenant is asking.
 *
 * `req.user` if some earlier middleware already authenticated (the case if
 * this is ever mounted per-router), otherwise decoded from the bearer token
 * with the SAME `verifyJwt` the auth middleware uses — not a second
 * verification of its own.
 *
 * That fallback is what makes a single global mount possible. Mounting this
 * app-wide BEFORE the routers means `req.user` is not populated yet, because
 * every router runs its own `authenticateJWT`; a version that only read
 * `req.user` would therefore see `undefined` on every request, fail open every
 * time, and enforce nothing at all — silently, with all its tests passing.
 * That is the same shape as the documented `requireRole`-without-`requireAuth`
 * trap.
 *
 * One accepted imprecision: a token whose SESSION was revoked still carries a
 * real tenantId here, so a lapsed tenant using a revoked token gets 402 rather
 * than the 401 the auth layer would have given it. Both are refusals, and the
 * alternative — validating the session a second time — would double every
 * request's work to improve an error code.
 */
function resolveTenantId(req: Request): number | null {
  if (req.user) return req.user.tenantId ?? null;

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  const payload = verifyJwt(header.slice(7));
  return payload?.tenantId ?? null;
}

export function requireWritableSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!WRITE_METHODS.has(req.method)) return next();
  // Not on the gated list -- writable by construction. This is the branch
  // that used to be the bug: under the old allowlist it required an entry
  // to reach here; now it covers every trading route including ones
  // nobody has written yet, with no list to maintain.
  if (!isSubscriptionGated(req.originalUrl)) return next();

  const tenantId = resolveTenantId(req);
  // No tenant on the request: either unauthenticated (some other middleware's
  // problem) or a platform user, who has no subscription to lapse.
  if (tenantId === null) return next();

  let canWrite = true;
  try {
    canWrite = getSubscriptionService().canWrite(tenantId);
  } catch (error) {
    // A failed lookup must not stop a shop trading.
    logger.error(
      { error, tenantId },
      "subscription check failed; allowing the write",
    );
    return next();
  }

  if (canWrite) return next();

  logger.warn(
    { tenantId, method: req.method, path: req.originalUrl },
    "administrative write blocked: subscription is read-only",
  );

  // IPC-identical envelope, and HTTP 402 rather than 403: this is not a
  // permission the user could be granted by an admin, it is an account state.
  // The adapter branches on `success`, so the status code is informational --
  // but a distinct one makes this diagnosable in a log without opening bodies.
  //
  // The message no longer claims the app is read-only -- it isn't, by
  // design (see the module doc comment): only administrative changes are
  // refused, and trading keeps working through this exact same lapse.
  res.status(402).json({
    success: false,
    error:
      "Your subscription has lapsed. Administrative changes (staff, " +
      "settings, modules, catalogues) are unavailable, but you can keep " +
      "trading normally -- sales, payments, and sessions are unaffected. " +
      "Contact support to restore full access.",
    code: "SUBSCRIPTION_READ_ONLY",
  });
}
