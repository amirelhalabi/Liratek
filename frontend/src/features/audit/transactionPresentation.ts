/**
 * ONE registry describing how each transaction type is PRESENTED in the
 * transactions table — label, colour, cash-flow badge direction.
 *
 * Why this exists (OCP): these three concerns used to live in three
 * independent `Record<string, …>` / `switch` maps — `STATIC_TYPE_LABELS` and
 * `TYPE_COLORS` in `pages/TransactionsViewer.tsx`, and the big switch in
 * `cashFlow.ts`. Keyed on a plain `string`, each silently defaulted for a
 * type it had never heard of, so adding a transaction type meant remembering
 * to edit N scattered places and nothing failed if you didn't. It didn't
 * fail loudly; it failed as a blank cell. Two shipped bugs came from exactly
 * that: `DRAWER_TOPUP` was entirely absent from the direction switch and
 * rendered NO badge at all (found by the Top-Up Cash-Flow Direction Audit),
 * and the same type's foreign-currency amount/method rendered "—" (owner
 * report 2026-08-28).
 *
 * This record is typed `Record<TransactionType, …>` against core's OWN
 * union, so a type added to `packages/core/src/constants/transactionTypes.ts`
 * is a COMPILE ERROR here until someone describes it once. Extension by
 * addition, not by hunting down every switch — that is the whole point, and
 * the reason a deliberate "nothing special" entry (`label: null`,
 * slate colour, `direction: null`) is preferable to an absent one: it is a
 * decision on the record rather than an omission nobody can see.
 *
 * The import is `import type` — erased at compile time — so this module stays
 * runtime-dependency-free and can be imported by `cashFlow.ts` (deliberately
 * unit-testable without the Electron/DB stack) and by frontend jest, whose
 * `@liratek/core` mapping points at core's BROWSER entry.
 */
import type { TransactionType } from "@liratek/core";

/** Which way cash physically moved — drives the green ↓ / red ↑ badge.
 *  `null` renders no badge at all (a paper entry where no cash moved). */
export type CashFlowDirection = "in" | "out" | "both";

export type TransactionPresentation = {
  /**
   * Type-column label. `null` means "no fixed label": the caller either
   * derives one from the row's metadata (see `getTypeLabel`'s per-type
   * branches — FINANCIAL_SERVICE/RECHARGE/RECHARGE_TOPUP/WALLET_EXCHANGE
   * read `metadata.provider` etc.) or falls back to the humanised type
   * string (`SALE` → "SALE", `DEBT_REPAYMENT` → "DEBT REPAYMENT").
   */
  label: string | null;
  /** Tailwind text colour class for the Type column. */
  color: string;
  /**
   * The badge direction, or `"dynamic"` when it cannot be known from the
   * type alone and `getCashFlowDirection` resolves it from the row's
   * metadata/signed amounts (a SUPPLIER_PAYMENT is "in" or "out" depending
   * on who paid whom; a RECHARGE_TOPUP depends on which drawer funded it).
   * `null` = deliberately no badge: the type never moves drawer cash.
   */
  direction: CashFlowDirection | "dynamic" | null;
};

/** Used for a `type` string that isn't a known TransactionType — a legacy or
 *  hand-written DB row. Byte-identical to the old per-map fallbacks. */
export const FALLBACK_PRESENTATION: TransactionPresentation = {
  label: null,
  color: "text-slate-300",
  direction: null,
};

export const TRANSACTION_PRESENTATION: Record<
  TransactionType,
  TransactionPresentation
> = {
  // ── Revenue ───────────────────────────────────────────────────────────
  SALE: { label: null, color: "text-green-400", direction: "in" },
  // Label AND colour are provider-derived (OMT / Whish / iPick / Katsh /
  // Binance …); direction depends on service_type — a SEND/BILL takes the
  // customer's cash, a RECEIVE pays them out, and a fee-on-top RECEIVE does
  // both. The values here are the fallbacks when metadata says nothing.
  FINANCIAL_SERVICE: {
    label: null,
    color: "text-blue-400",
    direction: "dynamic",
  },
  EXCHANGE: { label: null, color: "text-yellow-400", direction: "both" },
  WALLET_EXCHANGE: {
    label: null,
    color: "text-yellow-300",
    direction: "both",
  },
  // LIRA-090 §5.2: an internal stock transfer between the shop's own drawers
  // and its own carrier line. No customer, so no cash badge.
  TELECOM_SELF_CHARGE: {
    label: null,
    color: "text-slate-300",
    direction: null,
  },
  // CARRIER_LINES_VALIDITY_PLAN.md Phase 6 (D7): the shop BUYS credits back
  // from the customer and pays cash out — the opposite of a RECHARGE sale.
  TELECOM_CREDIT_BUYBACK: {
    label: null,
    color: "text-slate-300",
    direction: "out",
  },
  // Primary Cash Drawer plan §8.6: a same-shop transfer between two of our
  // own drawers — one leg each way, hence "both".
  DRAWER_TRANSFER: { label: null, color: "text-slate-300", direction: "both" },
  RECHARGE: { label: null, color: "text-purple-400", direction: "in" },
  // Four funding/destination shapes (TOPUP_CASHFLOW_DIRECTION_AUDIT.md) —
  // resolved from metadata, never from the type.
  RECHARGE_TOPUP: {
    label: null,
    color: "text-purple-300",
    direction: "dynamic",
  },
  MTC_TOPUP: {
    label: "MTC Top-up",
    color: "text-violet-400",
    direction: "in",
  },
  ALFA_TOPUP: {
    label: "Alfa Top-up",
    color: "text-violet-300",
    direction: "in",
  },
  CUSTOM_SERVICE: { label: null, color: "text-cyan-400", direction: "in" },
  MAINTENANCE: { label: null, color: "text-amber-400", direction: "in" },

  // ── Loto ──────────────────────────────────────────────────────────────
  // B7: LOTO and LOTO_CASH_PRIZE were both unmapped (blank badge) before the
  // cash-flow audit — a ticket sale takes cash in, a prize pays cash out.
  LOTO: { label: "Loto", color: "text-lime-500", direction: "in" },
  LOTO_CASH_PRIZE: {
    label: "Loto Prize",
    color: "text-lime-400",
    direction: "out",
  },
  LOTO_SETTLEMENT: {
    label: "Loto Settlement",
    color: "text-lime-300",
    direction: "out",
  },
  LOTO_MONTHLY_FEE: {
    label: "Loto Monthly Fee",
    color: "text-lime-400",
    direction: "out",
  },

  // ── Outflows ──────────────────────────────────────────────────────────
  EXPENSE: { label: null, color: "text-red-400", direction: "out" },

  // ── Drawer adjustments ────────────────────────────────────────────────
  // External (Cash In) mode is "in" (new money from outside); From-Drawer
  // mode debits a real source drawer into General, so it reads "both" —
  // distinguished by `metadata.source_drawer`, hence dynamic.
  DRAWER_TOPUP: {
    label: "General Top-up",
    color: "text-slate-300",
    direction: "dynamic",
  },
  DRAWER_CASHOUT: {
    label: "General Cash-Out",
    color: "text-rose-300",
    direction: "out",
  },

  // ── Hold money ────────────────────────────────────────────────────────
  HOLD_MONEY: {
    label: "Money Held",
    color: "text-orange-400",
    direction: null,
  },
  HOLD_MONEY_COLLECT: {
    label: "Hold Returned",
    color: "text-orange-300",
    direction: null,
  },

  // ── Debt & supplier & partner ─────────────────────────────────────────
  DEBT_REPAYMENT: { label: null, color: "text-emerald-400", direction: "in" },
  CREDIT_CASH_OUT: {
    label: null,
    color: "text-slate-300",
    direction: "out",
  },
  CREDIT_CASH_IN: {
    label: "Account Credit",
    color: "text-emerald-400",
    direction: "in",
  },
  DEBT_CASH_OUT: {
    label: "Cash Advance",
    color: "text-rose-400",
    direction: "out",
  },
  // T3: a profit-only row, amount 0 — the tender is booked by the basket's
  // own payment legs, so this row moves no cash of its own.
  KEPT_CHANGE: { label: null, color: "text-slate-300", direction: null },
  // Spans both directions: paying a supplier empties the drawer, a supplier
  // paying us back fills it — read from the CQ-8 counterparty contract.
  SUPPLIER_PAYMENT: {
    label: null,
    color: "text-indigo-400",
    direction: "dynamic",
  },
  // "out" for a normal net settlement, "in" for the bills-only
  // commission-at-settlement shape (LIRA-137).
  SUPPLIER_SETTLEMENT: {
    label: "Supplier Settlement",
    color: "text-indigo-300",
    direction: "dynamic",
  },
  // Partners get their own colour family — teal is taken by CLIENT_* and
  // cyan by CUSTOM_SERVICE, so "sky" keeps them distinct while staying in
  // the same cool-hue neighbourhood. Direction comes from the counterparty
  // flow, with a signed-amount fallback for pre-contract rows.
  PARTNER_SETTLEMENT: {
    label: "Partner Settlement",
    color: "text-sky-400",
    direction: "dynamic",
  },
  PARTNER_PAYMENT: {
    label: "Partner Payment",
    color: "text-sky-300",
    direction: "dynamic",
  },
  // The three "paper" (no-cash) ledger corrections — LIRA-066 / LIRA-080.
  // Same sky/emerald/indigo family one shade lighter, and a deliberately
  // blank badge: a green/red arrow would misrepresent a row where no cash
  // moved.
  PARTNER_ADJUSTMENT: {
    label: "Partner Adjustment",
    color: "text-sky-200",
    direction: null,
  },
  ACCOUNT_ADJUSTMENT: {
    label: "Account Adjustment",
    color: "text-emerald-300",
    direction: null,
  },
  SUPPLIER_ADJUSTMENT: {
    label: "Supplier Adjustment",
    color: "text-indigo-200",
    direction: null,
  },
  // CQ-10: one label for all three counterparty kinds (debt/supplier/
  // partner) — the row's metadata.counterparty says which. Fuchsia is
  // otherwise unused, keeping "Discount" distinct from every other family.
  COUNTERPARTY_DISCOUNT: {
    label: "Discount",
    color: "text-fuchsia-400",
    direction: null,
  },

  // ── Bookkeeping ───────────────────────────────────────────────────────
  // A count, not a movement. The Amount column shows the counted physical
  // totals from metadata; the badge stays blank.
  CHECKPOINT: { label: "Checkpoint", color: "text-slate-400", direction: null },
  // A REFUND's money movement is carried by its own reversal payment legs,
  // which the legs subtext renders; the type alone implies no direction.
  REFUND: { label: null, color: "text-rose-400", direction: null },

  // ── Client activity log ───────────────────────────────────────────────
  // CLIENT_CREATED is blanket-hidden from the table (HIDDEN_TRANSACTION_TYPES)
  // but still needs an entry: the record is exhaustive by design, and the
  // other two render.
  CLIENT_CREATED: { label: null, color: "text-teal-400", direction: null },
  CLIENT_UPDATED: { label: null, color: "text-teal-300", direction: null },
  CLIENT_DELETED: { label: null, color: "text-teal-500", direction: null },
};

/**
 * Presentation for a row's `type`. Takes a plain `string` because
 * `transactions.type` is a DB column, not a compile-time union — an unknown
 * or legacy value degrades to {@link FALLBACK_PRESENTATION} instead of
 * throwing.
 */
export function presentationFor(type: string): TransactionPresentation {
  return (
    (TRANSACTION_PRESENTATION as Record<string, TransactionPresentation>)[
      type
    ] ?? FALLBACK_PRESENTATION
  );
}
