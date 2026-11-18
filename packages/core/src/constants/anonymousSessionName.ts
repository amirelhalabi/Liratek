/**
 * LIRA-393 — the automatic name the Sessions page gives an unnamed basket.
 *
 * Starting a Walk-In basket names it `Client1`, `Client2`, … (the first
 * number not already used by one of today's baskets). The name is stored on
 * the session and copied onto every transaction the basket writes, with no
 * client id. It is a label the shop never typed and carries no identity, so
 * reports treat it as "Walk-in" (Profits › By Client and every drill-down's
 * counterpart). The Sessions and Transactions pages keep showing it on
 * purpose — the cashier finds the basket by it.
 *
 * This module is the ONE definition of the pattern (rule 14): the generator
 * (`CustomerSessionButton.tsx`), the JS matcher (Profits drill-downs) and the
 * SQL matcher (`ProfitRepository.getByClient`) all come from here. A test
 * (`__tests__/anonymousSessionName.test.ts`) runs the JS and SQL matchers over
 * the same names so the two cannot drift.
 *
 * Leaf module, no imports: it is reachable from `browser.ts` (rule 29).
 */

/** The generator writes exactly this prefix followed by digits, no space. */
export const ANONYMOUS_SESSION_NAME_PREFIX = "Client";

/** What reports show instead of an anonymous basket's name. */
export const WALK_IN_LABEL = "Walk-in";

const ANONYMOUS_SESSION_NAME_RE = new RegExp(
  `^${ANONYMOUS_SESSION_NAME_PREFIX}[0-9]+$`,
);

/** True for an automatic basket name: exactly `Client` + digits. */
export function isAnonymousSessionName(
  name: string | null | undefined,
): boolean {
  return typeof name === "string" && ANONYMOUS_SESSION_NAME_RE.test(name);
}

/** The next free automatic name: the first `Client<N>` (N from 1) that is
 *  not in `existingNames` (today's basket names). */
export function nextAnonymousSessionName(
  existingNames: readonly string[],
): string {
  const taken = new Set(existingNames);
  let counter = 1;
  while (taken.has(`${ANONYMOUS_SESSION_NAME_PREFIX}${counter}`)) {
    counter++;
  }
  return `${ANONYMOUS_SESSION_NAME_PREFIX}${counter}`;
}

/**
 * SQL twin of {@link isAnonymousSessionName} for the expression `expr`
 * (a column or a pure expression — it is repeated, so never pass anything
 * with a `?`). GLOB, not LIKE: GLOB is case-sensitive, so `client7` does not
 * match. Adds no bind parameters.
 */
export function isAnonymousSessionNameSql(expr: string): string {
  const after = ANONYMOUS_SESSION_NAME_PREFIX.length + 1;
  return `(${expr} GLOB '${ANONYMOUS_SESSION_NAME_PREFIX}[0-9]*' AND substr(${expr}, ${after}) NOT GLOB '*[^0-9]*')`;
}

/**
 * The counterpart shown on a Profits drill-down row: the name, else the
 * phone, else "Walk-in". An automatic basket name with no client id counts
 * as no name. `clientId` is optional because most drill-down rows do not
 * carry it; when it is absent an automatic name is treated as anonymous.
 */
export function counterpartLabel(
  name: string | null | undefined,
  phone?: string | null,
  clientId?: number | null,
): string {
  const usableName =
    name && (clientId != null || !isAnonymousSessionName(name)) ? name : null;
  return usableName || phone || WALK_IN_LABEL;
}
