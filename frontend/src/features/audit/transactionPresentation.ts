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
 * Labels come from core's TRANSACTION_TYPE_LABELS (LIRA-301), shared with the
 * phone app; only colour and badge direction are decided here. Core's browser
 * entry is pure, so this module stays unit-testable without the Electron/DB
 * stack (cashFlow.ts and frontend jest import it).
 */
import { TRANSACTION_TYPE_LABELS, type TransactionType } from "@liratek/core";

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
  SALE: { label: TRANSACTION_TYPE_LABELS.SALE, color: "text-green-400", direction: "in" },
  // Label AND colour are provider-derived (OMT / Whish / iPick / Katsh /
  // Binance …); direction depends on service_type — a SEND/BILL takes the
  // customer's cash, a RECEIVE pays them out, and a fee-on-top RECEIVE does
  // both. The values here are the fallbacks when metadata says nothing.
  FINANCIAL_SERVICE: {
    label: TRANSACTION_TYPE_LABELS.FINANCIAL_SERVICE,
    color: "text-blue-400",
    direction: "dynamic",
  },
  EXCHANGE: { label: TRANSACTION_TYPE_LABELS.EXCHANGE, color: "text-yellow-400", direction: "both" },
  WALLET_EXCHANGE: {
    label: TRANSACTION_TYPE_LABELS.WALLET_EXCHANGE,
    color: "text-yellow-300",
    direction: "both",
  },
  // LIRA-090 §5.2: an internal stock transfer between the shop's own drawers
  // and its own carrier line. No customer, so no cash badge.
  TELECOM_SELF_CHARGE: {
    label: TRANSACTION_TYPE_LABELS.TELECOM_SELF_CHARGE,
    color: "text-slate-300",
    direction: null,
  },
  // CARRIER_LINES_VALIDITY_PLAN.md Phase 6 (D7): the shop BUYS credits back
  // from the customer and pays cash out — the opposite of a RECHARGE sale.
  TELECOM_CREDIT_BUYBACK: {
    label: TRANSACTION_TYPE_LABELS.TELECOM_CREDIT_BUYBACK,
    color: "text-slate-300",
    direction: "out",
  },
  // Primary Cash Drawer plan §8.6: a same-shop transfer between two of our
  // own drawers — one leg each way, hence "both".
  DRAWER_TRANSFER: { label: TRANSACTION_TYPE_LABELS.DRAWER_TRANSFER, color: "text-slate-300", direction: "both" },
  RECHARGE: { label: TRANSACTION_TYPE_LABELS.RECHARGE, color: "text-purple-400", direction: "in" },
  // LIRA-252 wave 2 — a manual SIM-line hand-edit (create/edit/quick-update/
  // deactivate/reactivate/archive, Settings → Carrier Lines or the
  // Recharge-tab inline balance update). `amount_usd` is a SIGNED credits
  // delta (positive = credits added to the drawer, negative = removed — see
  // `postCarrierDrawerAdjustment`), same shape as PARTNER_SETTLEMENT/
  // PARTNER_PAYMENT, so direction is resolved from that sign below
  // (cashFlow.ts) rather than fixed here. The full "Line adjustment — MTC
  // 03924245: +$200.00 (edited)" detail is the row's own `summary` (rendered
  // verbatim by SummaryCell); this is just the Type-column label.
  CARRIER_LINE_ADJUSTMENT: {
    label: TRANSACTION_TYPE_LABELS.CARRIER_LINE_ADJUSTMENT,
    color: "text-violet-200",
    direction: "dynamic",
  },
  // Four funding/destination shapes (TOPUP_CASHFLOW_DIRECTION_AUDIT.md) —
  // resolved from metadata, never from the type.
  RECHARGE_TOPUP: {
    label: TRANSACTION_TYPE_LABELS.RECHARGE_TOPUP,
    color: "text-purple-300",
    direction: "dynamic",
  },
  // LIRA-192 (OMT open-credit account, §8): the OMT App wallet's own
  // cash-out — the mirror of an OMT_APP RECHARGE_TOPUP. Direction is fixed
  // "out", unlike RECHARGE_TOPUP: the OMT_App drawer only ever DECREASES
  // here (the principal + commission become debt on the OMT account, no
  // drawer ever receives cash), so there is no metadata-dependent shape to
  // resolve — styled like the existing DRAWER_CASHOUT entry (fixed "out",
  // rose family) rather than the dynamic RECHARGE_TOPUP above it.
  WALLET_CASHOUT: {
    label: TRANSACTION_TYPE_LABELS.WALLET_CASHOUT,
    color: "text-rose-300",
    direction: "out",
  },
  MTC_TOPUP: {
    label: TRANSACTION_TYPE_LABELS.MTC_TOPUP,
    color: "text-violet-400",
    direction: "in",
  },
  ALFA_TOPUP: {
    label: TRANSACTION_TYPE_LABELS.ALFA_TOPUP,
    color: "text-violet-300",
    direction: "in",
  },
  // OWNER_NOTES_REMAINING_BUILD.md #16 — a Via-Partner custom service can now
  // be a PAYOUT (direction "OUT" in metadata_json — see cashFlow.ts's
  // CUSTOM_SERVICE case), so the fixed "in" answer is wrong for that row
  // shape. Every other custom service (the overwhelming majority — no
  // partner, For-Partner, or ordinary Via-Partner IN) still resolves to
  // "in", exactly as before; only the new payout shape reads "out".
  CUSTOM_SERVICE: { label: TRANSACTION_TYPE_LABELS.CUSTOM_SERVICE, color: "text-cyan-400", direction: "dynamic" },
  MAINTENANCE: { label: TRANSACTION_TYPE_LABELS.MAINTENANCE, color: "text-amber-400", direction: "in" },

  // ── Loto ──────────────────────────────────────────────────────────────
  // B7: LOTO and LOTO_CASH_PRIZE were both unmapped (blank badge) before the
  // cash-flow audit — a ticket sale takes cash in, a prize pays cash out.
  LOTO: { label: TRANSACTION_TYPE_LABELS.LOTO, color: "text-lime-500", direction: "in" },
  LOTO_CASH_PRIZE: {
    label: TRANSACTION_TYPE_LABELS.LOTO_CASH_PRIZE,
    color: "text-lime-400",
    direction: "out",
  },
  LOTO_SETTLEMENT: {
    label: TRANSACTION_TYPE_LABELS.LOTO_SETTLEMENT,
    color: "text-lime-300",
    direction: "out",
  },
  LOTO_MONTHLY_FEE: {
    label: TRANSACTION_TYPE_LABELS.LOTO_MONTHLY_FEE,
    color: "text-lime-400",
    direction: "out",
  },

  // ── Outflows ──────────────────────────────────────────────────────────
  EXPENSE: { label: TRANSACTION_TYPE_LABELS.EXPENSE, color: "text-red-400", direction: "out" },
  // LIRA-262 — "the shop used its own stock": an expense at cost. Owner
  // decision 2026-10-06: badge reads OUT (value left the shop — out of stock
  // or a provider's prepaid balance), even though no cash drawer moves.
  EXPENSE_INVENTORY: {
    label: TRANSACTION_TYPE_LABELS.EXPENSE_INVENTORY,
    color: "text-red-400",
    direction: "out",
  },
  EXPENSE_KATSH: {
    label: TRANSACTION_TYPE_LABELS.EXPENSE_KATSH,
    color: "text-red-400",
    direction: "out",
  },
  EXPENSE_IPICK: {
    label: TRANSACTION_TYPE_LABELS.EXPENSE_IPICK,
    color: "text-red-400",
    direction: "out",
  },
  EXPENSE_WHISH_APP: {
    label: TRANSACTION_TYPE_LABELS.EXPENSE_WHISH_APP,
    color: "text-red-400",
    direction: "out",
  },

  // ── Drawer adjustments ────────────────────────────────────────────────
  // External (Cash In) mode is "in" (new money from outside); From-Drawer
  // mode debits a real source drawer into General, so it reads "both" —
  // distinguished by `metadata.source_drawer`, hence dynamic.
  DRAWER_TOPUP: {
    label: TRANSACTION_TYPE_LABELS.DRAWER_TOPUP,
    color: "text-slate-300",
    direction: "dynamic",
  },
  DRAWER_CASHOUT: {
    label: TRANSACTION_TYPE_LABELS.DRAWER_CASHOUT,
    color: "text-rose-300",
    direction: "out",
  },

  // ── Hold money ────────────────────────────────────────────────────────
  HOLD_MONEY: {
    label: TRANSACTION_TYPE_LABELS.HOLD_MONEY,
    color: "text-orange-400",
    direction: null,
  },
  HOLD_MONEY_COLLECT: {
    label: TRANSACTION_TYPE_LABELS.HOLD_MONEY_COLLECT,
    color: "text-orange-300",
    direction: null,
  },
  // LIRA-214 (migration v183): the per-pickup reversal owner (rule 20) —
  // voiding a HOLD_MONEY_COLLECT pickup re-credits every drawer it paid out
  // of, so cash flows back IN.
  HOLD_MONEY_COLLECT_VOID: {
    label: TRANSACTION_TYPE_LABELS.HOLD_MONEY_COLLECT_VOID,
    color: "text-orange-200",
    direction: "in",
  },

  // ── Debt & supplier & partner ─────────────────────────────────────────
  DEBT_REPAYMENT: { label: TRANSACTION_TYPE_LABELS.DEBT_REPAYMENT, color: "text-emerald-400", direction: "in" },
  CREDIT_CASH_OUT: {
    label: TRANSACTION_TYPE_LABELS.CREDIT_CASH_OUT,
    color: "text-slate-300",
    direction: "out",
  },
  CREDIT_CASH_IN: {
    label: TRANSACTION_TYPE_LABELS.CREDIT_CASH_IN,
    color: "text-emerald-400",
    direction: "in",
  },
  DEBT_CASH_OUT: {
    label: TRANSACTION_TYPE_LABELS.DEBT_CASH_OUT,
    color: "text-rose-400",
    direction: "out",
  },
  // T3: a profit-only row, amount 0 — the tender is booked by the basket's
  // own payment legs, so this row moves no cash of its own.
  KEPT_CHANGE: { label: TRANSACTION_TYPE_LABELS.KEPT_CHANGE, color: "text-slate-300", direction: null },
  // LIRA-296 — the cost of honouring a warranty (or a recovery offsetting
  // it): profit-only, no payment legs, no drawer — so no cash badge.
  WARRANTY_COST: {
    label: TRANSACTION_TYPE_LABELS.WARRANTY_COST,
    color: "text-amber-300",
    direction: null,
  },
  // Spans both directions: paying a supplier empties the drawer, a supplier
  // paying us back fills it — read from the CQ-8 counterparty contract.
  SUPPLIER_PAYMENT: {
    label: TRANSACTION_TYPE_LABELS.SUPPLIER_PAYMENT,
    color: "text-indigo-400",
    direction: "dynamic",
  },
  // "out" for a normal net settlement, "in" for the bills-only
  // commission-at-settlement shape (LIRA-137).
  SUPPLIER_SETTLEMENT: {
    label: TRANSACTION_TYPE_LABELS.SUPPLIER_SETTLEMENT,
    color: "text-indigo-300",
    direction: "dynamic",
  },
  // Partners get their own colour family — teal is taken by CLIENT_* and
  // cyan by CUSTOM_SERVICE, so "sky" keeps them distinct while staying in
  // the same cool-hue neighbourhood. Direction comes from the counterparty
  // flow, with a signed-amount fallback for pre-contract rows.
  PARTNER_SETTLEMENT: {
    label: TRANSACTION_TYPE_LABELS.PARTNER_SETTLEMENT,
    color: "text-sky-400",
    direction: "dynamic",
  },
  PARTNER_PAYMENT: {
    label: TRANSACTION_TYPE_LABELS.PARTNER_PAYMENT,
    color: "text-sky-300",
    direction: "dynamic",
  },
  // The three "paper" (no-cash) ledger corrections — LIRA-066 / LIRA-080.
  // Same sky/emerald/indigo family one shade lighter, and a deliberately
  // blank badge: a green/red arrow would misrepresent a row where no cash
  // moved.
  PARTNER_ADJUSTMENT: {
    label: TRANSACTION_TYPE_LABELS.PARTNER_ADJUSTMENT,
    color: "text-sky-200",
    direction: null,
  },
  ACCOUNT_ADJUSTMENT: {
    label: TRANSACTION_TYPE_LABELS.ACCOUNT_ADJUSTMENT,
    color: "text-emerald-300",
    direction: null,
  },
  SUPPLIER_ADJUSTMENT: {
    label: TRANSACTION_TYPE_LABELS.SUPPLIER_ADJUSTMENT,
    color: "text-indigo-200",
    direction: null,
  },
  // SUPPLIER_STOCK_INTAKE_PLAN.md — receiving stock on credit books ONE
  // supplier_ledger debit (source_table 'supplier_ledger') and NO payment
  // legs/drawer delta at all — same "paper, no cash moved" shape as
  // SUPPLIER_ADJUSTMENT immediately above, hence the identical blank badge.
  // Reversible (NOT in core's NON_REVERSIBLE_TRANSACTION_TYPES) so the void
  // path can undo a mistaken delivery — see ACTIONABLE_TYPES in
  // auditConstants.ts, which is what actually renders the Void button.
  SUPPLIER_STOCK_INTAKE: {
    label: TRANSACTION_TYPE_LABELS.SUPPLIER_STOCK_INTAKE,
    color: "text-indigo-200",
    direction: null,
  },
  // LIRA-087 (migration v189) — recording a supplier debt without a product
  // line yet is the same "paper, no cash moved" shape as SUPPLIER_STOCK_INTAKE
  // immediately above (one ledger debit, no payment legs/drawer delta).
  SUPPLIER_RECORDED_DEBT: {
    label: TRANSACTION_TYPE_LABELS.SUPPLIER_RECORDED_DEBT,
    color: "text-indigo-200",
    direction: null,
  },
  // CQ-10: one label for all three counterparty kinds (debt/supplier/
  // partner) — the row's metadata.counterparty says which. Fuchsia is
  // otherwise unused, keeping "Discount" distinct from every other family.
  COUNTERPARTY_DISCOUNT: {
    label: TRANSACTION_TYPE_LABELS.COUNTERPARTY_DISCOUNT,
    color: "text-fuchsia-400",
    direction: null,
  },

  // ── Bookkeeping ───────────────────────────────────────────────────────
  // A count, not a movement. The Amount column shows the counted physical
  // totals from metadata; the badge stays blank.
  CHECKPOINT: { label: TRANSACTION_TYPE_LABELS.CHECKPOINT, color: "text-slate-400", direction: null },
  // A REFUND's money movement is carried by its own reversal payment legs,
  // which the legs subtext renders; the type alone implies no direction.
  REFUND: { label: TRANSACTION_TYPE_LABELS.REFUND, color: "text-rose-400", direction: null },
  // LIRA-147 — same reasoning as REFUND immediately above: an admin "Undo
  // refund" row's money movement is carried by its own payment legs (the
  // negated inverse of the refund's), rendered by the same legs subtext.
  REFUND_UNDO: {
    label: TRANSACTION_TYPE_LABELS.REFUND_UNDO,
    color: "text-amber-400",
    direction: null,
  },

  // ── Client activity log ───────────────────────────────────────────────
  // CLIENT_CREATED is blanket-hidden from the table (HIDDEN_TRANSACTION_TYPES)
  // but still needs an entry: the record is exhaustive by design, and the
  // other two render.
  CLIENT_CREATED: { label: TRANSACTION_TYPE_LABELS.CLIENT_CREATED, color: "text-teal-400", direction: null },
  CLIENT_UPDATED: { label: TRANSACTION_TYPE_LABELS.CLIENT_UPDATED, color: "text-teal-300", direction: null },
  CLIENT_DELETED: { label: TRANSACTION_TYPE_LABELS.CLIENT_DELETED, color: "text-teal-500", direction: null },
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
