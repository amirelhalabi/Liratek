import {
  convert,
  MoneyError,
  type RateSide,
  type RateTable,
} from "@liratek/ui";
import type { TransactionRow } from "./hooks/useTransactionRows";

/**
 * LIRA-139 — the Amount column's sort value for the transactions table.
 *
 * The bug: the column's `sortKey` is `"amount_usd"`, and the old
 * `getSortValue` branch answered `row.amount_usd ?? 0` directly. An
 * LBP-primary row (e.g. a cash-in-LBP sale) stores its money in
 * `amount_lbp` and carries `amount_usd: 0`, so every LBP row sorted as
 * worth nothing — worse, they all tied at 0 and weren't even ordered among
 * themselves.
 *
 * The rule (owner decision, LIRA-139):
 *  - The sort value is the row's total expressed in **USD**, the app's base
 *    currency — every `RateTable` in the app is quoted against USD
 *    (`packages/ui/src/money/types.ts:27-34`), so USD is the one unit every
 *    row can be compared in.
 *  - Conversion uses **the row's own stamped `exchange_rate`**, never
 *    today's live rate. This is the owner's explicit call: a historical
 *    row's position in the sort must never move just because the shop's
 *    rate moved after the row was written.
 *  - **Mixed USD+LBP rows add both sides**: the sort value is
 *    `amount_usd + (amount_lbp converted to USD at the row's rate)`. A row
 *    that legitimately carries money on both sides is worth the sum, not
 *    either side alone.
 *  - **Null/degenerate rate fallback**: when the row's `exchange_rate` is
 *    null/0/negative/NaN (no rate was ever stamped), the LBP side converts
 *    at the shop's *current* buy rate instead — passed in by the caller
 *    from `useSellRate()`. The buy side is the app-wide convention for
 *    LBP→USD conversion (owner decision 2026-07-06, cited verbatim at
 *    `frontend/src/features/debts/pages/Debts/index.tsx:2068-2070` and
 *    `frontend/src/features/sessions/components/SessionCheckoutModal.tsx:979-981`).
 *    This fallback only ever affects rows that never got a stamped rate —
 *    every other row still sorts strictly by its own historical rate.
 *  - Only the currency conversion used to ORDER rows changes here. The
 *    DISPLAYED cell (`AmountCell`/`formatAmount`) is completely untouched —
 *    an LBP row still reads e.g. "8,500,000 LBP"; only its position in the
 *    sorted list changes.
 *  - Signed `PARTNER_*` rows keep their sign exactly as before this change
 *    — this function does no sign manipulation of its own, it only adds
 *    the (possibly negative) `amount_usd`/`amount_lbp` fields as given.
 */

/** Every RateTable in the app is quoted against USD — see the module doc. */
const SORT_BASE_CURRENCY = "USD";
const LBP_CODE = "LBP";

/**
 * Which side of the quote to use when converting. This only matters for the
 * injected `fallbackUsdToLbpRate` path: when converting at a row's OWN
 * stamped `exchange_rate`, the same number is placed on both the buy and
 * sell side of the built RateTable (mirroring
 * `MultiPaymentInput.tsx:347-353`), so the side is immaterial there. "buy"
 * is the app-wide convention for LBP→USD conversion (owner decision
 * 2026-07-06 — see the module doc above).
 */
const SORT_RATE_SIDE: RateSide = "buy";

/**
 * Returns `rate` only when it is a finite positive number, else `null`.
 * `convert`/`crossRate` THROW `MoneyError` on a missing/0/negative/NaN rate
 * (`packages/ui/src/money/convert.ts:8-14`), so every rate reaching
 * `convert` below must be pre-validated here rather than handed through.
 */
function usableRate(rate: number | null | undefined): number | null {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate
    : null;
}

/**
 * The Amount column's sort value: the row's total expressed in USD. See the
 * module doc above for the full rule.
 */
export function amountSortValue(
  row: Pick<TransactionRow, "amount_usd" | "amount_lbp" | "exchange_rate">,
  fallbackUsdToLbpRate: number,
): number {
  // Defensive coercion: the fields are declared `number` on TransactionRow,
  // but the ticket documents runtime nulls arriving on some rows.
  // `Number.isFinite(null)` is `false`, so this handles that without
  // weakening the declared type.
  const usd = Number.isFinite(row.amount_usd) ? row.amount_usd : 0;
  const lbp = Number.isFinite(row.amount_lbp) ? row.amount_lbp : 0;

  // A same-currency (pure-USD) row is rate-independent by construction —
  // mirrors the money engine's own identity invariant I3
  // (`convert.ts:29-33`). No conversion needed, and none attempted.
  if (!lbp) return usd;

  const rate =
    usableRate(row.exchange_rate) ?? usableRate(fallbackUsdToLbpRate);

  if (rate === null) {
    // Unreachable given useSellRate's guarantee that buyRate is always a
    // positive finite number, but a caller could pass garbage. Documented
    // last resort: compare LBP units as if 1 LBP = 1 USD. This is an
    // arbitrary cross-currency ordering, but a STABLE one — LBP rows still
    // rank correctly among themselves, and critically never collapse back
    // to 0 (that collapse is the exact bug this ticket fixes).
    return usd + lbp;
  }

  const rates: RateTable = {
    base: SORT_BASE_CURRENCY,
    rates: { [LBP_CODE]: { buy: rate, sell: rate } },
  };

  try {
    return (
      usd +
      convert(
        { amount: lbp, currency: LBP_CODE },
        SORT_BASE_CURRENCY,
        rates,
        SORT_RATE_SIDE,
      ).amount
    );
  } catch (err) {
    // Mirrors MultiPaymentInput.convertSafe (:357-366): a MoneyError falls
    // back to the same documented last resort as the null-rate branch
    // above. Anything else is a genuine bug and must not be swallowed.
    if (err instanceof MoneyError) return usd + lbp;
    throw err;
  }
}
