/**
 * LIRA-322 — pure helpers for the OMT account Settle Account sheet, kept out
 * of the component so they are unit-testable and so the sheet's preview
 * feeds the core allocator EXACTLY what the server feeds it
 * (`SupplierRepository._planAmountFirstSection`, rule 14):
 *
 *   - money applies per currency only (USD money to USD rows, LBP to LBP);
 *   - rows are the in-scope queue rows whose remaining in that currency is
 *     beyond the tolerance ($0.005 / 0.5 LBP);
 *   - `paid` = direction sign × (IN legs − change legs) in that currency;
 *   - `commission_model1` = a FINANCIAL_SERVICE row with commission_model 1;
 *   - `cashout_commission` = the row's commission in that currency.
 *
 * The old "collapse a mixed USD/LBP net into one USD figure" rule
 * (`collapseNetBalance`) is gone on purpose: OMT never settles one currency
 * with the other (FR-001/FR-003), and that merged figure is what made the
 * server refuse "$507.11" (research F1).
 *
 * All `remaining_*` amounts here are already signed (+ the shop owes OMT,
 * − OMT owes the shop) by `getAccountUnsettled`; nothing here re-signs.
 */
import {
  allocateAccountSettlement,
  compareAccountSettleRows,
  isOmtRowCovered,
  type AccountSettleAllocResult,
  type OmtCoveredType,
} from "@liratek/core";
import type { AccountUnsettledRow } from "../hooks/useSuppliers";

export type SettleCurrency = "USD" | "LBP";
export type SettleDirection = "PAY" | "COLLECT";

export const SETTLE_CURRENCIES: readonly SettleCurrency[] = ["USD", "LBP"];

/** Same tolerances as the server's `AMOUNT_FIRST_EPS`. */
export const SETTLE_EPS: Record<SettleCurrency, number> = {
  USD: 0.005,
  LBP: 0.5,
};

/** Composite selection key — a FINANCIAL_SERVICE row and a LEDGER row can
 *  legitimately share a numeric `id` (they're different tables), so the
 *  `kind` must be part of the key or the two would collide in one `Set`. */
export function accountRowKey(row: { kind: string; id: number }): string {
  return `${row.kind}:${row.id}`;
}

/** Oldest first, in the ONE row order the server allocates in
 *  (`compareAccountSettleRows`: `created_at` as a string, then kind, then
 *  id). Returns a new array — never mutates the query's cached result. */
export function sortOldestFirst<
  T extends Pick<AccountUnsettledRow, "kind" | "id" | "created_at">,
>(rows: T[]): T[] {
  return [...rows].sort(compareAccountSettleRows);
}

/** Signed remaining of a row in one currency. */
export function rowRemaining(
  row: Pick<AccountUnsettledRow, "remaining_usd" | "remaining_lbp">,
  currency: SettleCurrency,
): number {
  return (currency === "USD" ? row.remaining_usd : row.remaining_lbp) || 0;
}

/**
 * LIRA-256 — a new-style (commission_model = 1) OMT transfer whose type the
 * statement does not cover waits for a later statement: it is out of scope
 * and cannot be picked. Old-style rows and LEDGER rows are never
 * restricted. Same predicate the server's scope uses (`isOmtRowCovered`).
 */
export function isWaitingRow(
  row: AccountUnsettledRow,
  covered: OmtCoveredType[] | undefined,
): boolean {
  return (
    row.kind === "FINANCIAL_SERVICE" &&
    row.commission_model === 1 &&
    !isOmtRowCovered(
      {
        provider: row.source_provider,
        omt_service_type: row.omt_service_type ?? null,
      },
      covered,
    )
  );
}

/**
 * The rows a settlement covers — the server's `_amountFirstScope`: the
 * ticked rows when any are ticked, otherwise the whole queue minus the
 * waiting rows.
 */
export function settlementScope(
  rows: AccountUnsettledRow[],
  picked: ReadonlySet<string>,
  covered: OmtCoveredType[] | undefined,
): AccountUnsettledRow[] {
  if (picked.size > 0) {
    return rows.filter(
      (r) => picked.has(accountRowKey(r)) && !isWaitingRow(r, covered),
    );
  }
  return rows.filter((r) => !isWaitingRow(r, covered));
}

/** Signed in-scope remaining per currency — the sheet's `expected_owed`
 *  (FR-021). Raw sums, the same arithmetic the server repeats. */
export function scopeOwed(rows: AccountUnsettledRow[]): {
  usd: number;
  lbp: number;
} {
  return {
    usd: rows.reduce((s, r) => s + rowRemaining(r, "USD"), 0),
    lbp: rows.reduce((s, r) => s + rowRemaining(r, "LBP"), 0),
  };
}

/** In-scope rows that still owe something in this currency. */
export function rowsInCurrency(
  rows: AccountUnsettledRow[],
  currency: SettleCurrency,
): AccountUnsettledRow[] {
  return rows.filter(
    (r) => Math.abs(rowRemaining(r, currency)) > SETTLE_EPS[currency],
  );
}

/** The direction what is owed in a currency dictates: + PAY, − COLLECT,
 *  null when nothing is owed (the operator may choose). */
export function directionFromOwed(
  owed: number,
  currency: SettleCurrency,
): SettleDirection | null {
  if (owed > SETTLE_EPS[currency]) return "PAY";
  if (owed < -SETTLE_EPS[currency]) return "COLLECT";
  return null;
}

/** Cents for USD, whole units for LBP; never −0. */
export function roundMoney(value: number, currency: SettleCurrency): number {
  const f = currency === "USD" ? 100 : 1;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}

export interface SectionMoney {
  /** IN legs in this currency (money paid toward rows). */
  inSame: number;
  /** Change (OUT) legs in this currency. */
  outSame: number;
  commission: number;
}

/**
 * Run the core allocator for one currency section, exactly as the server
 * does (see the header comment).
 */
export function allocateSection(
  rows: AccountUnsettledRow[],
  currency: SettleCurrency,
  direction: SettleDirection,
  money: SectionMoney,
): AccountSettleAllocResult {
  const dirSign = direction === "PAY" ? 1 : -1;
  return allocateAccountSettlement({
    currency,
    rows: rowsInCurrency(rows, currency).map((r) => ({
      kind: r.kind,
      id: r.id,
      member_supplier_id: r.supplier_id,
      created_at: r.created_at,
      remaining: rowRemaining(r, currency),
      commission_model1:
        r.kind === "FINANCIAL_SERVICE" && r.commission_model === 1,
      cashout_commission:
        currency === "USD" ? r.commission_usd : r.commission_lbp,
    })),
    paid: dirSign * (money.inSame - money.outSame),
    commission: money.commission,
    waive: 0,
    eps: SETTLE_EPS[currency],
  });
}

/** The tolerance the payment box (`MultiPaymentInput`) uses to call a
 *  currency short or overpaid ($0.01 / 100 LBP — its `matchTolerance`). The
 *  sheet decides which section a change leg belongs to with the SAME figure,
 *  so it agrees with the box about which currency is overpaid. */
export const BOX_MATCH_TOLERANCE: Record<SettleCurrency, number> = {
  USD: 0.01,
  LBP: 100,
};

/**
 * LIRA-322 (one payment box for both currencies) — which currency section
 * each change (OUT) leg is sent in. A change leg must go to the section of
 * the currency that was OVERPAID: in a short section it would be subtracted
 * from that currency's payment and silently net the two currencies.
 *
 * - One currency overpaid: every change leg goes to its section (change may
 *   come back in either currency — the server books a leg in the other
 *   currency as that currency's extra, LIRA-315).
 * - Both overpaid: each leg fills its OWN currency's section up to that
 *   currency's extra; anything above it is split off into the other
 *   section (as a cross-currency leg). So "$3 + 89,000 LBP" over, handed
 *   back as $3 + 89,000 LBP, sends $3 in USD and 89,000 LBP in LBP; handed
 *   back all in $ ($4), sends $3 in USD and $1 in LBP. Each section's change
 *   then stays within its own extra (`_resolveSettlementLegs`).
 * - Nothing overpaid (should not happen — the box emits change only when
 *   it sees an overpay): everything goes to `fallback`.
 *
 * `extras` are what each currency was overpaid by, in that currency.
 */
export function assignChangeLegs<
  T extends { currencyCode: string; amount: number },
>(
  legs: readonly T[],
  extras: Partial<Record<SettleCurrency, number>>,
  fallback: SettleCurrency,
): Record<SettleCurrency, T[]> {
  const out: Record<SettleCurrency, T[]> = { USD: [], LBP: [] };
  const paidLegs = legs.filter((l) => l.amount > 0);
  const overpaid = SETTLE_CURRENCIES.filter(
    (c) => (extras[c] ?? 0) > BOX_MATCH_TOLERANCE[c],
  );
  if (overpaid.length < 2) {
    out[overpaid[0] ?? fallback].push(...paidLegs);
    return out;
  }
  const room: Record<SettleCurrency, number> = {
    USD: extras.USD ?? 0,
    LBP: extras.LBP ?? 0,
  };
  for (const leg of paidLegs) {
    const own: SettleCurrency = leg.currencyCode === "LBP" ? "LBP" : "USD";
    const other: SettleCurrency = own === "USD" ? "LBP" : "USD";
    const take = roundMoney(Math.min(leg.amount, room[own]), own);
    if (take > 0) {
      out[own].push({ ...leg, amount: take });
      room[own] -= take;
    }
    const rest = roundMoney(leg.amount - take, own);
    if (rest > 0) out[other].push({ ...leg, amount: rest });
  }
  return out;
}
