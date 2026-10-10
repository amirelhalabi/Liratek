/**
 * Pure display logic for ONE transaction row — labels, colours, amounts,
 * method strings, the cash-flow badge, session accents.
 *
 * Extracted from `pages/TransactionsViewer.tsx`, which was 1749 lines and
 * held ~8 responsibilities at once. None of this needs React state, the API
 * adapter, or the page: it is row-in/string-out, so it belongs beside the
 * other pure audit modules (`cashFlow`, `auditConstants`, `actionGating`,
 * `receiptGating`) where it can be unit-tested without rendering a table.
 *
 * Per-type label/colour/direction values are NOT here — they live in the one
 * exhaustive `transactionPresentation` registry. What stays here is the
 * metadata-derived logic that runs before that lookup. The CashFlowBadge
 * COMPONENT lives in ./components/CashFlowBadge — a module may export
 * components or helpers, not both (react-refresh/only-export-components).
 */
import type { CSSProperties } from "react";
import {
  CHECKPOINT_ADJUSTMENT_METHOD,
  PROVIDER_LABELS,
  COMMISSION_MODE_OTHER_PAYMENT,
  COMMISSION_MODE_TOP_UP,
  billsOnlyCommissionAmount,
  cashLegsFor,
  cashMovementLine,
  checkpointPhysicalTotals,
  displayAmountFields,
  fallbackMethodLabel,
  formatCheckpointAmounts,
  isProviderBalanceInflow,
  isSignedAmountType,
  isSupplierCredit,
  methodLegsFor,
  sessionPooledCashLegsFor,
  sessionPooledMethodLegsFor,
  sessionHue,
  sessionReversalLine,
  transactionSummary,
  transactionTitle,
} from "@liratek/core";
import {
  formatLegAmount,
  extraCurrencyLegs,
  type TransactionPaymentLeg,
} from "./cashFlow";
import { presentationFor } from "./transactionPresentation";
import type { TransactionRow } from "./hooks/useTransactionRows";

// Type label helpers
// ---------------------------------------------------------------------------

// Provider names and the title rules live in core (LIRA-301), shared with
// the phone app; re-exported under their existing names for this app.
export { PROVIDER_LABELS };

export function getTypeLabel(row: TransactionRow): string {
  return transactionTitle(row);
}

// ---------------------------------------------------------------------------
// Type color helpers
// ---------------------------------------------------------------------------

// The fixed per-type colours moved into `../transactionPresentation`
// alongside the labels and badge directions (one registry, exhaustive
// against core's TransactionType). Only the metadata-derived colours
// below stay here; they run FIRST and fall through to the registry.
export function getTypeColor(row: TransactionRow): string {
  if (
    row.type === "FINANCIAL_SERVICE" ||
    row.type === "RECHARGE" ||
    row.type === "RECHARGE_TOPUP"
  ) {
    try {
      const meta = JSON.parse(row.metadata_json ?? "{}") as Record<
        string,
        unknown
      >;
      switch (meta.provider) {
        case "OMT":
        case "OMT_APP":
        case "OMT_SYSTEM":
          return "text-blue-400";
        case "WHISH":
        case "WHISH_APP":
        case "WHISH_SYSTEM":
          return "text-cyan-400";
        case "iPick":
          return "text-orange-300";
        case "Katsh":
          return "text-orange-400";
        case "BINANCE":
          return "text-yellow-400";
        case "MTC":
          return "text-purple-400";
        case "Alfa":
          return "text-purple-300";
      }
    } catch {
      // fall through
    }
  }
  if (row.type === "CHECKPOINT") {
    try {
      const meta = JSON.parse(row.metadata_json ?? "{}") as { notes?: string };
      if (
        meta.notes &&
        (meta.notes.toLowerCase().includes("initial") ||
          meta.notes.toLowerCase().includes("setup"))
      ) {
        return "text-orange-400";
      }
    } catch {
      /* fall through */
    }
  }
  return presentationFor(row.type).color;
}

// ---------------------------------------------------------------------------
// Amount formatter
// ---------------------------------------------------------------------------

export function formatAmount(
  usd: number,
  lbp: number,
  metaJson?: string | null,
  /** Row type — required only to surface a drawer top-up / cash-out's
   *  non-USD/LBP money, which lives in `metadata_json.extra_currencies`
   *  rather than in `usd`/`lbp` (see `extraCurrencyLegs`). Omitted by call
   *  sites that format an already-derived figure (e.g. a supplier credit's
   *  commission), which have no extra currencies to add. */
  type?: string,
): string {
  const parts: string[] = [];
  // Production test 2026-10-07: a negative amount (a void or refund) read
  // "$-4.25". A real minus sign goes before the currency, like
  // ReturnedCreditsCell's "−$73".
  const sign = (n: number) => (n < 0 ? "−" : "");
  if (usd) parts.push(`${sign(usd)}$${Math.abs(usd).toLocaleString()}`);
  if (lbp) parts.push(`${sign(lbp)}${Math.abs(lbp).toLocaleString()} LBP`);
  // A €100 top-up carries 0/0 in usd/lbp — without this the Amount column and
  // the cash-flow badge both render "—" (owner report 2026-08-28). A MIXED
  // top-up ($50 + €100) appends, so neither side is hidden by the other.
  if (type) {
    for (const leg of extraCurrencyLegs(type, metaJson)) {
      parts.push(formatLegAmount(leg));
    }
  }
  if (!parts.length && metaJson) {
    try {
      const meta = JSON.parse(metaJson) as Record<string, unknown>;
      const amt = meta.amount;
      const cur = meta.currency;
      if (
        typeof amt === "number" &&
        amt &&
        typeof cur === "string" &&
        cur !== "USD"
      ) {
        parts.push(`${amt.toFixed(2)} ${cur}`);
      }
    } catch {
      /* ignore */
    }
  }
  return parts.join(" + ") || "—";
}

// ---------------------------------------------------------------------------
// Transaction amount vs cash movement (production test 2026-10-07)
// ---------------------------------------------------------------------------









/** The summary line to SHOW for a row — core's shared wording (LIRA-301). */
export function displaySummary(row: TransactionRow): string | null {
  return transactionSummary(row);
}

// ---------------------------------------------------------------------------
// Structured payment legs (LIRA-064) — formatPaymentLegs now lives in
// ../cashFlow (imported above).
// ---------------------------------------------------------------------------


/**
 * Per-leg method label for the payment-detail rows (LIRA-067 expander /
 * export). A checkpoint reconciliation leg names its own drawer — e.g.
 * "Checkpoint General" instead of the generic "Checkpoint Adjustment" —
 * because a single checkpoint can post one adjustment leg per drawer, and
 * without the drawer name every one of them reads identically. Falls back to
 * today's expression (`labelByCode` lookup, then title-cased method code) for
 * every other leg, and for a checkpoint leg with no `drawer_name` (legacy
 * rows predating this field).
 *
 * Deliberately NOT used by `formatPaymentMethods` (the Method column): that
 * function dedupes labels across all of a row's legs, so drawer-specific
 * labels would turn a nine-drawer checkpoint's Method cell into "Checkpoint
 * General + Checkpoint OMT_System + …". The Method column keeps reading
 * "Checkpoint Adjustment" — this is a deliberate scope decision, not an
 * inconsistency to "fix" later.
 */
export function legMethodLabel(
  leg: TransactionPaymentLeg,
  labelByCode: Map<string, string>,
): string {
  if (leg.method === CHECKPOINT_ADJUSTMENT_METHOD && leg.drawer_name) {
    return `Checkpoint ${leg.drawer_name}`;
  }
  return labelByCode.get(leg.method) ?? fallbackMethodLabel(leg.method);
}

/**
 * How the transaction was paid, for the Method column. Prefers "in" legs
 * (what the customer paid with) over "out" legs (change/return) when both
 * exist on the same row. But sole-payout flows — EXPENSE, SUPPLIER_PAYMENT,
 * CREDIT_CASH_OUT, LOTO_CASH_PRIZE, etc. — only ever write an "out" leg (no
 * customer paid-in side), so falling back to "out" when there's no "in" leg
 * is required or those rows would render blank despite clearly having a
 * method. Split payments join distinct methods, e.g. "Cash + OMT Wallet".
 */
export function formatPaymentMethods(
  legs: TransactionPaymentLeg[] | undefined,
  labelByCode: Map<string, string>,
): string {
  if (!legs || legs.length === 0) return "—";
  const hasInLeg = legs.some((leg) => leg.direction === "in");
  const relevant = hasInLeg
    ? legs.filter((leg) => leg.direction === "in")
    : legs;
  const labels = new Set<string>();
  for (const leg of relevant) {
    labels.add(labelByCode.get(leg.method) ?? fallbackMethodLabel(leg.method));
  }
  return labels.size ? [...labels].join(" + ") : "—";
}





// ---------------------------------------------------------------------------
// Checkpoint drawer-amount breakdown (shown in the summary column)
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// Cash flow direction
// ---------------------------------------------------------------------------


/**
 * A supplier credit booked in our favour with NO cash movement — e.g. the fixed
 * commission earned when selling an iPick/Katsh bill. The supplier_ledger stores
 * it as a negative (credit) entry so its running balance stays valid; the journal
 * mirrors it as a positive magnitude flagged `is_credit`. This is a receivable,
 * not drawer cash, so it must not render with the green "cash in" arrow used for
 * real receipts (recordSupplierCashflow's RECEIVE — which has no `is_credit`).
 */
// Moved to core (utils/transactionRowDisplay.ts, utils/cashFlow.ts) so the
// phone's Activity tab describes a row the same way; re-exported unchanged.
export {
  billsOnlyCommissionAmount,
  cashLegsFor,
  cashMovementLine,
  checkpointPhysicalTotals,
  displayAmountFields,
  fallbackMethodLabel,
  formatCheckpointAmounts,
  isProviderBalanceInflow,
  isSignedAmountType,
  isSupplierCredit,
  methodLegsFor,
  sessionPooledCashLegsFor,
  sessionPooledMethodLegsFor,
  sessionReversalLine,
};
export type { CheckpointAmountEntry } from "@liratek/core";




/**
 * LIRA-137 owner follow-up (2026-08-15) — "either method picked, should
 * appear in the payment detail in the transaction metadata": names WHICH
 * collection mode a bills-only settlement used, reading the SAME
 * `metadata_json.commission_collection_mode` field `SupplierRepository`
 * stamps (rule 14 — never re-derived here). Only ever called for a row
 * `billsOnlyCommissionAmount` already accepted (the caller gates on that),
 * so this never re-derives that predicate either.
 *
 *   - TOP_UP: `methodLegsFor(row)` is empty for this mode — the drawer
 *     top-up leg's `drawer_name` ("Katsh"/"iPick") is a
 *     `PROVIDER_STOCK_DRAWERS` member, stripped from `row.payments` one
 *     layer before this page ever sees the row (same fact
 *     `billsOnlyCommissionAmount`'s own doc comment explains) — so this
 *     line IS the entire disclosure: names the destination drawer (reading
 *     `metadata_json.counterparty.method`, the real provider per the
 *     SupplierRepository fix — no longer the generic literal "CASH") and
 *     the credited amount.
 *   - OTHER_PAYMENT: a real leg already renders via `methodLegsFor` — this
 *     just names the mode alongside it, never repeating the leg's own
 *     drawer/amount.
 *
 * Returns null for any other/malformed `commission_collection_mode` so the
 * caller degrades to "no line" rather than a thrown error or a half-built
 * disclosure — defensive only; every REAL bills-only row always carries one
 * of the two literal modes (SupplierRepository defaults the field to
 * "TOP_UP" whenever it stamps it at all).
 */
export function billsCommissionModeLine(
  row: TransactionRow,
  commissionAmount: { usd: number; lbp: number },
  labelByCode: Map<string, string>,
): string | null {
  if (!row.metadata_json) return null;
  try {
    const meta = JSON.parse(row.metadata_json) as {
      commission_collection_mode?: unknown;
      counterparty?: { method?: unknown } | null;
    };
    const mode = meta.commission_collection_mode;
    if (mode === COMMISSION_MODE_OTHER_PAYMENT) return "Other payment";
    if (mode !== COMMISSION_MODE_TOP_UP) return null;
    const providerMethod =
      typeof meta.counterparty?.method === "string"
        ? meta.counterparty.method
        : null;
    const drawerLabel = providerMethod
      ? (labelByCode.get(providerMethod) ?? fallbackMethodLabel(providerMethod))
      : "provider";
    const leg: TransactionPaymentLeg =
      Math.abs(commissionAmount.usd) > 0.005
        ? {
            direction: "in",
            amount: commissionAmount.usd,
            signed_amount: commissionAmount.usd,
            currency_code: "USD",
            method: providerMethod ?? "",
          }
        : {
            direction: "in",
            amount: commissionAmount.lbp,
            signed_amount: commissionAmount.lbp,
            currency_code: "LBP",
            method: providerMethod ?? "",
          };
    return `Top-up → ${drawerLabel} drawer  ${formatLegAmount(leg)}`;
  } catch {
    return null;
  }
}

/**
 * CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): a row stamped with
 * `split_group` is one unit of a multi-unit split-payment checkout
 * (KatshForm bills / FinancialForm catalog units). Voiding a single member
 * alone is refused by the repository guard — the operator must void the
 * whole checkout via `voidCheckoutGroup`. Returns null for ordinary rows and
 * for legacy pre-fix split rows that predate this marker (undetectable by
 * design — see the doc).
 */
export function getSplitGroupInfo(
  metaJson: string | null,
): { groupId: string; units: number | null } | null {
  if (!metaJson) return null;
  try {
    const m = JSON.parse(metaJson) as {
      split_group?: unknown;
      split_units?: unknown;
    };
    if (typeof m.split_group !== "string" || m.split_group.length === 0) {
      return null;
    }
    return {
      groupId: m.split_group,
      units: typeof m.split_units === "number" ? m.split_units : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-session left-border accent (WS8)
// ---------------------------------------------------------------------------

export { sessionHue };

/** Inline style carrying the CSS custom property consumed by
 *  `tr[data-session]` rules in index.css. */
export function sessionVars(sessionId: number): CSSProperties {
  return { "--session-hue": sessionHue(sessionId) } as CSSProperties;
}
