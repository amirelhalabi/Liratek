/**
 * LIRA-233 (#14 slice 3 review round, finding 10) — the ONE list of By
 * Module keys `ProfitService.getModuleDetail`'s dispatch registry has an
 * entry for. Before this fix, `Profits.tsx` hand-maintained its OWN copy
 * (`MODULE_DETAIL_SUPPORTED_KEYS`/`MODULE_DETAIL_SUPPORTED_PREFIXES`) to
 * decide whether to render the "Show transactions" button at all — a second,
 * re-typed spelling of the exact same list the registry already encodes,
 * with nothing forcing the two to agree (rule 14). A module added to the
 * registry without a matching frontend edit would silently show no button;
 * a module removed from the registry without a matching frontend edit would
 * show a button that always errors.
 *
 * Rule 29 — reachable from `packages/core/src/browser.ts` (the frontend
 * needs it), so this file stays a pure leaf: no Node built-in, no DB, no
 * import of `ProfitService`/`ProfitRepository` (both pull in
 * `better-sqlite3`). It is intentionally a plain data list, not derived by
 * introspecting the registry at runtime — the registry lives on
 * `ProfitService`, which is not something `browser.ts` can reach at all.
 *
 * Used by BOTH sides now: `ProfitService.getModuleDetail` checks
 * {@link hasModuleDetailSupport} before even consulting its own registry
 * (so a drift between this list and the registry fails loudly, server-side,
 * instead of silently returning nothing) and `Profits.tsx` gates its "Show
 * transactions" button on the same function.
 */
export const MODULE_DETAIL_SUPPORTED_KEYS: ReadonlySet<string> = new Set([
  "SALE",
  "CUSTOM_SERVICE",
  "MAINTENANCE",
  "LOTO",
  "EXCHANGE",
  "PM_FEE",
  "KEPT_CHANGE",
  "COUNTERPARTY_DISCOUNT",
  "SUPPLIER_COMMISSION",
  "TOPUP_BUYBACK",
]);

/** `RECHARGE_`/`FINANCIAL_SERVICE_` carry their carrier/provider suffix in
 *  the module key, so they match by prefix rather than an exact key. */
export const MODULE_DETAIL_SUPPORTED_PREFIXES: readonly string[] = [
  "RECHARGE_",
  "FINANCIAL_SERVICE_",
];

export function hasModuleDetailSupport(moduleKey: string): boolean {
  return (
    MODULE_DETAIL_SUPPORTED_KEYS.has(moduleKey) ||
    MODULE_DETAIL_SUPPORTED_PREFIXES.some((prefix) =>
      moduleKey.startsWith(prefix),
    )
  );
}
