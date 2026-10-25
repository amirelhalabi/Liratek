/**
 * Which OUT (change) legs a sale or a repair checkout may carry — ONE
 * definition (rule 14), owner-approved 2026-10-25.
 *
 * Cash change travels only as `change_given_usd/lbp`. The only OUT leg a
 * checkout accepts is CUSTOMER_ACCOUNT: change put on the client's account
 * as store credit. A CASH (or any other drawer) OUT leg is refused, because
 * a request carrying it AND `change_given_*` posted the change twice
 * (SalesRepository: "Change returned" + "Change given" → the drawer
 * debited twice and the payment snapshot showing the change doubled).
 *
 * Used by `saleProcessSchema` and `saveMaintenanceJobSchema` (the edge, both
 * transports) and by `SalesRepository.processSale` /
 * `MaintenanceRepository.processPayments` (repository callers bypass Zod).
 * A session-basket item (`deferPayment`) is NOT checked: the basket owns the
 * payment and its change, so its legs are never posted by the item.
 *
 * Pure leaf, zero imports — reachable from `browser.ts` via the validators
 * barrel, so it must never import a Node built-in (rule 29).
 */

/** The one payment method allowed on an OUT (change) leg. */
export const ALLOWED_CHANGE_LEG_METHOD = "CUSTOMER_ACCOUNT";

/** Edge (schema) message — shown to the cashier on either transport. */
export const CASH_CHANGE_LEG_MESSAGE =
  "Change handed back must be entered as change given, not as a returned payment line — only a Customer Account line may be an OUT leg.";

interface ChangeLegLike {
  method: string;
  direction?: "IN" | "OUT" | undefined;
}

/** The first OUT leg whose method is not CUSTOMER_ACCOUNT, if any. */
export function findDisallowedChangeLeg<T extends ChangeLegLike>(
  legs: readonly T[] | null | undefined,
): T | undefined {
  return (legs ?? []).find(
    (l) => l.direction === "OUT" && l.method !== ALLOWED_CHANGE_LEG_METHOD,
  );
}

/** True when every OUT leg is CUSTOMER_ACCOUNT (or there is none). */
export function hasOnlyAllowedChangeLegs(
  legs: readonly ChangeLegLike[] | null | undefined,
): boolean {
  return findDisallowedChangeLeg(legs) === undefined;
}

/**
 * Repository-side guard: throws when a non-account OUT leg is present.
 * `context` names the record in the message (e.g. "Maintenance job #12",
 * "Sale"). Call it only on a checkout that posts its own legs — never on a
 * session-basket item.
 */
export function assertNoCashChangeLeg(
  legs: readonly ChangeLegLike[] | null | undefined,
  context: string,
): void {
  const leg = findDisallowedChangeLeg(legs);
  if (leg) {
    throw new Error(
      `Change handed back must be entered as change given, not as a returned ${leg.method} line (${context}: only ${ALLOWED_CHANGE_LEG_METHOD} may be an OUT leg)`,
    );
  }
}
