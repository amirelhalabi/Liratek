/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, wave 2, lane W6) — pure
 * arithmetic for the OMT account settle sheet, kept out of the component so
 * it's independently unit-testable and so the same "collapse mixed USD/LBP
 * into one currency + direction" rule used by the pre-existing Pay/Receive
 * tab (`Suppliers/index.tsx`'s `payAmount`/`payCurrency`/`defaultDirection`
 * memo) isn't pasted a second time inline in the sheet (rule 14 — one
 * definition, reused). Not imported FROM `index.tsx` (that file exports
 * nothing) — this is the account-settlement sibling of the same formula,
 * factored out once so both call sites can share it going forward.
 *
 * `entry_type` is never in this file. All amount fields here are raw
 * `supplier_ledger`-shaped USD/LBP components carried by
 * `AccountUnsettledRow`, which are ALREADY signed the right way (positive =
 * shop owes; negative = the account owes the shop, e.g. an OMT App cashout)
 * — see `SupplierRepository.getAccountUnsettled`'s own doc comment. Nothing
 * here re-derives or re-signs anything.
 */

/** The subset of `AccountUnsettledRow` this module actually reads — kept
 *  minimal and structural so a caller with the real (richer) type satisfies
 *  it for free. `commission_usd`/`commission_lbp` are REQUIRED, matching
 *  `AccountUnsettledRow`'s own contract: `getAccountUnsettled` populates
 *  them unconditionally (always 0 for a non-cashout row), so a caller here
 *  never needs an `?? 0` guard either. */
export interface AccountSettleRowLike {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  amount_usd: number;
  amount_lbp: number;
  created_at: string;
  commission_usd: number;
  commission_lbp: number;
}

/** Composite selection key — a FINANCIAL_SERVICE row and a LEDGER row can
 *  legitimately share a numeric `id` (they're different tables), so the
 *  `kind` must be part of the key or the two would collide in one `Set`. */
export function accountRowKey(row: { kind: string; id: number }): string {
  return `${row.kind}:${row.id}`;
}

/** Oldest-first, matching `getAccountUnsettled`'s own ordering convention
 *  and D8 ("oldest rows pre-selected"). Returns a new array — never mutates
 *  the query's cached result. */
export function sortOldestFirst<T extends { created_at: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export interface SelectionTotals {
  /** Sum of |amount| across selected rows, per currency — "how much money,
   *  regardless of direction, this selection touches" (the
   *  `supplier-account-settle-selected-total` figure). */
  selectedTotalUsd: number;
  selectedTotalLbp: number;
  /** Signed sum across selected rows, per currency — credits (negative
   *  rows) net against debts automatically (the
   *  `supplier-account-settle-net` figure). */
  netUsd: number;
  netLbp: number;
  /** Sum of the per-row commission fields across selected rows — 0 for any
   *  selection with no cashout row (`AccountSettleRowLike`'s doc comment). */
  deferredCommissionUsd: number;
  deferredCommissionLbp: number;
}

export function computeSelectionTotals(
  rows: AccountSettleRowLike[],
  selected: ReadonlySet<string>,
): SelectionTotals {
  let selectedTotalUsd = 0;
  let selectedTotalLbp = 0;
  let netUsd = 0;
  let netLbp = 0;
  let deferredCommissionUsd = 0;
  let deferredCommissionLbp = 0;
  for (const row of rows) {
    if (!selected.has(accountRowKey(row))) continue;
    const usd = row.amount_usd || 0;
    const lbp = row.amount_lbp || 0;
    selectedTotalUsd += Math.abs(usd);
    selectedTotalLbp += Math.abs(lbp);
    netUsd += usd;
    netLbp += lbp;
    deferredCommissionUsd += row.commission_usd;
    deferredCommissionLbp += row.commission_lbp;
  }
  return {
    selectedTotalUsd,
    selectedTotalLbp,
    netUsd,
    netLbp,
    deferredCommissionUsd,
    deferredCommissionLbp,
  };
}

export interface CollapsedBalance {
  amount: number;
  currency: "USD" | "LBP";
  direction: "PAY" | "COLLECT";
}

/**
 * Collapse a mixed USD/LBP net into ONE currency + a PAY/COLLECT direction —
 * the account-settlement sibling of `Suppliers/index.tsx`'s pre-existing
 * `payAmount`/`payCurrency`/`defaultDirection` memo (same three-case shape:
 * pure USD, pure LBP, mixed collapses to USD via `exchangeRate`). Positive
 * net = the shop owes the account = PAY; negative = the account owes the
 * shop (e.g. cashouts outweighing debt, §8.4) = COLLECT.
 */
export function collapseNetBalance(
  usd: number,
  lbp: number,
  exchangeRate: number,
  epsUsd = 0.005,
  epsLbp = 0.5,
): CollapsedBalance {
  const hasUsd = Math.abs(usd) > epsUsd;
  const hasLbp = Math.abs(lbp) > epsLbp;

  if (hasLbp && hasUsd) {
    const netUsd = lbp / exchangeRate + usd;
    return {
      amount: netUsd,
      currency: "USD",
      direction: netUsd >= 0 ? "PAY" : "COLLECT",
    };
  }
  if (hasLbp) {
    return { amount: lbp, currency: "LBP", direction: lbp >= 0 ? "PAY" : "COLLECT" };
  }
  return { amount: usd, currency: "USD", direction: usd >= 0 ? "PAY" : "COLLECT" };
}
