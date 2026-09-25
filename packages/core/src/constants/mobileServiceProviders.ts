/**
 * Cost/price "mobile services" providers — iPick, Katsh, BOB. Their
 * `financial_services` profit is a MARGIN (price − cost), never a
 * commission fee, unlike `COMMISSION_PROVIDERS` (commissionProviders.ts:
 * OMT/WHISH/OMT_APP/WHISH_APP/BINANCE) or a wallet balance
 * (`WALLET_PROVIDERS`, walletProviders.ts).
 *
 * Spellings must match the `financial_services.provider` schema CHECK
 * constraint exactly ('Katsh', not 'KATCH' — SQLite's IN is case-sensitive;
 * a 'KATCH' entry here would silently match zero rows).
 *
 * Canonical list (CLAUDE.md rule 14 — a business predicate is defined ONCE
 * and reused). Was previously TWO separate hand-copied SQL literals:
 * `ProfitRepository.ts`'s private `MOBILE_PROVIDERS` and
 * `SalesRepository.ts`'s private `TELECOM_ITEM_PROVIDERS_SQL` (DC-4,
 * OWNER_NOTES_2026-09-21.md §7.1) — the duplication existed only because
 * `ProfitRepository.ts` was off-limits to the lane that added the second
 * copy (shared-tree protocol). Both now import
 * `MOBILE_SERVICE_PROVIDERS_SQL_LIST` from here instead (mirrors
 * `COMMISSION_PROVIDERS_SQL_LIST`'s own convention in
 * commissionProviders.ts).
 */
export const MOBILE_SERVICE_PROVIDERS = ["iPick", "Katsh", "BOB"] as const;

export type MobileServiceProvider = (typeof MOBILE_SERVICE_PROVIDERS)[number];

export function isMobileServiceProvider(
  provider: string,
): provider is MobileServiceProvider {
  return (MOBILE_SERVICE_PROVIDERS as readonly string[]).includes(provider);
}

/** SQL IN-list literal built from MOBILE_SERVICE_PROVIDERS — for query
 *  fragments (mirrors `WALLET_PROVIDERS_SQL_LIST`'s own convention in
 *  walletProviders.ts). */
export const MOBILE_SERVICE_PROVIDERS_SQL_LIST = MOBILE_SERVICE_PROVIDERS.map(
  (p) => `'${p}'`,
).join(", ");
