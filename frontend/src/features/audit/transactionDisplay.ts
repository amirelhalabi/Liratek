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
  formatLegAmount,
  extraCurrencyLegs,
  type TransactionPaymentLeg,
} from "./cashFlow";
import { presentationFor } from "./transactionPresentation";
import { RECHARGE_SUBTYPE_LABELS } from "@/shared/utils/rechargeLabels";
import type { TransactionRow } from "./hooks/useTransactionRows";

// Type label helpers
// ---------------------------------------------------------------------------

export const PROVIDER_LABELS: Record<string, string> = {
  // OMT / WHISH: the classic FINANCIAL_SERVICE provider (SEND/RECEIVE run on
  // that system), as opposed to the app wallet below — unaffected by the
  // Primary Cash Drawer relabel.
  OMT: "OMT System",
  WHISH: "Whish System",
  OMT_APP: "OMT App",
  WHISH_APP: "Whish App",
  // OMT_SYSTEM / WHISH_SYSTEM: the RECHARGE_TOPUP provider that tops up the
  // OMT_System/Whish_System drawer — under the Primary Cash Drawer model
  // (plan §1) that drawer is the physical cash till, not a provider system
  // balance, so the label follows the "Cash Drawer" wording used elsewhere
  // (auditConstants.ts FILTER_GROUPS).
  OMT_SYSTEM: "OMT Cash Drawer",
  WHISH_SYSTEM: "Whish Cash Drawer",
  iPick: "iPick",
  Katsh: "Katsh",
  BINANCE: "Binance",
  MTC: "MTC",
  Alfa: "Alfa",
};

// The fixed per-type labels moved into `../transactionPresentation` (one
// exhaustive registry shared with the colour and badge-direction lookups —
// see that module's header for why). Only the metadata-derived labels below
// stay here; they run FIRST and fall through to the registry's static label,
// then to the humanised type string.
export function getTypeLabel(row: TransactionRow): string {
  try {
    const meta = JSON.parse(row.metadata_json ?? "{}") as Record<
      string,
      unknown
    >;
    const p = meta.provider as string | undefined;
    const st = meta.service_type as string | undefined;
    const ik = meta.item_key;

    if (row.type === "FINANCIAL_SERVICE") {
      const base = (p && PROVIDER_LABELS[p]) ?? "Financial Service";
      if (p === "OMT_APP" || p === "BINANCE" || (p === "WHISH_APP" && !ik)) {
        if (st === "SEND") return `${base} Send`;
        if (st === "RECEIVE") return `${base} Recv`;
      }
      if (p === "WHISH_APP" && ik) return "Whish App Bills";
      if ((p === "iPick" || p === "Katsh") && st === "BILL")
        return `${base} Bill`;
      return base;
    }

    if (row.type === "RECHARGE") {
      const provLabel = (p && PROVIDER_LABELS[p]) ?? p ?? "Recharge";
      const subLabel =
        (meta.type && RECHARGE_SUBTYPE_LABELS[meta.type as string]) ?? "";
      return subLabel ? `${provLabel} ${subLabel}` : provLabel;
    }

    if (row.type === "RECHARGE_TOPUP") {
      const provLabel = (p && PROVIDER_LABELS[p]) ?? p ?? "Recharge";
      return `${provLabel} Top-up`;
    }

    if (row.type === "WALLET_EXCHANGE") {
      const drawerName = meta.drawer_name as string | undefined;
      const drawerLabel =
        drawerName === "Whish_App"
          ? "Whish App"
          : drawerName === "OMT_App"
            ? "OMT App"
            : "Wallet";
      return `${drawerLabel} Exchange`;
    }

    // A cashless supplier credit (e.g. bill commission) — distinct from a real
    // "Supplier Payment" (cash we pay them / they pay us).
    if (row.type === "SUPPLIER_PAYMENT" && meta.is_credit === true) {
      return "Supplier Credit";
    }

    if (row.type === "CHECKPOINT") {
      const notes = meta.notes as string | undefined;
      if (
        notes &&
        (notes.toLowerCase().includes("initial") ||
          notes.toLowerCase().includes("setup"))
      ) {
        return "Initial Setup";
      }
    }
  } catch {
    // fall through
  }

  return presentationFor(row.type).label ?? row.type.replace(/_/g, " ");
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
  if (usd) parts.push(`$${usd.toLocaleString()}`);
  if (lbp) parts.push(`${lbp.toLocaleString()} LBP`);
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
// Structured payment legs (LIRA-064) — formatPaymentLegs now lives in
// ../cashFlow (imported above).
// ---------------------------------------------------------------------------

/** Title-cases an unmapped method code as a fallback, e.g. "PM_FEE" → "Pm Fee". */
export function fallbackMethodLabel(method: string): string {
  return method
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
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

/**
 * Legs for the Method column only: cash/wallet `payments` legs plus any
 * CUSTOMER_ACCOUNT settlement from `account_payments` (debt_ledger). Kept out
 * of `row.payments` itself so the Summary column's cash-only in:/out: line is
 * unaffected — see the `account_payments` field doc on TransactionRow.
 */
export function methodLegsFor(row: TransactionRow): TransactionPaymentLeg[] {
  return [
    ...(row.payments ?? []),
    ...(row.account_payments ?? []),
    // Foreign-currency top-up / cash-out legs, rebuilt from metadata because
    // the upstream customer-cash filter strips them from `row.payments` —
    // without them the Method column reads "—" on a CASH deposit and the
    // "▸ payment detail" expander never appears. See `extraCurrencyLegs`.
    ...extraCurrencyLegs(row.type, row.metadata_json),
  ];
}

// ---------------------------------------------------------------------------
// Checkpoint drawer-amount breakdown (shown in the summary column)
// ---------------------------------------------------------------------------

export type CheckpointAmountEntry = {
  drawer_name: string;
  currency_code: string;
  physical_amount: number;
};

export function formatCheckpointAmounts(
  metaJson: string | null,
): string | null {
  if (!metaJson) return null;
  try {
    const meta = JSON.parse(metaJson) as { amounts?: CheckpointAmountEntry[] };
    if (!meta.amounts || meta.amounts.length === 0) return null;

    // Group non-zero amounts by drawer
    const byDrawer = new Map<string, CheckpointAmountEntry[]>();
    for (const entry of meta.amounts) {
      if (entry.physical_amount === 0) continue;
      if (!byDrawer.has(entry.drawer_name)) byDrawer.set(entry.drawer_name, []);
      byDrawer.get(entry.drawer_name)!.push(entry);
    }
    if (byDrawer.size === 0) return null;

    return [...byDrawer.entries()]
      .map(([drawer, entries]) => {
        const amtStr = entries
          .map((e) => {
            if (e.currency_code === "USD")
              return `$${e.physical_amount.toLocaleString()}`;
            if (e.currency_code === "LBP")
              return `${e.physical_amount.toLocaleString()} L`;
            return `${e.physical_amount.toLocaleString()} ${e.currency_code}`;
          })
          .join(" + ");
        return `${drawer}: ${amtStr}`;
      })
      .join(" · ");
  } catch {
    return null;
  }
}

export function checkpointPhysicalTotals(
  metaJson: string | null,
): { usd: number; lbp: number } | null {
  if (!metaJson) return null;
  try {
    const meta = JSON.parse(metaJson) as { amounts?: CheckpointAmountEntry[] };
    if (!meta.amounts) return null;
    let usd = 0,
      lbp = 0;
    for (const e of meta.amounts) {
      if (e.currency_code === "USD") usd += e.physical_amount;
      else if (e.currency_code === "LBP") lbp += e.physical_amount;
    }
    return { usd, lbp };
  } catch {
    return null;
  }
}

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
export function isSupplierCredit(
  type: string,
  metaJson?: string | null,
): boolean {
  if (type !== "SUPPLIER_PAYMENT" || !metaJson) return false;
  try {
    const m = JSON.parse(metaJson) as { is_credit?: boolean };
    return m.is_credit === true;
  } catch {
    return false;
  }
}

/**
 * PARTNER_SETTLEMENT/PARTNER_PAYMENT store SIGNED amount_usd/amount_lbp
 * (positive = cash in, negative = cash out) instead of the unsigned
 * magnitude every other transaction type uses — see
 * PartnerRepository.recordSettlementMoneyMovement. The sign itself is read
 * by cashFlow.ts's historical-row fallback; display always wants the plain
 * magnitude (same treatment as the supplier-credit case above).
 */
export function isSignedPartnerType(type: string): boolean {
  return type === "PARTNER_SETTLEMENT" || type === "PARTNER_PAYMENT";
}

/**
 * LIRA-137 residual (BILL_COMMISSION_SETTLEMENT_PLAN.md): a bills-only
 * commission settlement stores `amount_usd`/`amount_lbp` as a contractual
 * 0/0 — a bill's principal already left at creation, so there is no gross
 * amount owed to net. The real money is the commission credited into the
 * provider's own drawer (`SupplierRepository._bookBillsCommissionDrawerTopUp`)
 * — but that leg's `drawer_name` ("Katsh"/"iPick") is in
 * `TransactionRepository`'s `PROVIDER_STOCK_DRAWERS`, so `isInternalLegJs`
 * strips it out of `row.payments` entirely, one layer before the array
 * this page receives is even built (`_attachPaymentLegs`'s `toLeg`, which
 * returns null for it) — there is no leg to read here, by design, and this
 * function does not touch that filter.
 *
 * The SAME commission figure is also stamped onto `metadata_json` —
 * `commission_usd`/`commission_lbp`, sourced from the identical settlement
 * input that funded the drawer leg (SupplierRepository.ts's own doc comment
 * calls these "the real money-bearing totals" for exactly this batch shape)
 * — so this reads THAT field instead of inventing a new one.
 *
 * DISPLAY ONLY: returns a value for the Amount column alone. The row's own
 * `amount_usd`/`amount_lbp` are never touched — they keep meaning "cash
 * through a till" for receipts, the refund-override candidate set, and
 * ProfitRepository's own queries.
 *
 * Gated narrowly: only a bills-only batch (`commission_model === 1` AND
 * `counterparty.flow === "IN"`) with the contractual 0/0 stored amount.
 * Returns null for a legacy OMT/WHISH settlement (`commission_model` 0 or
 * absent) and for every other row type, which keep rendering exactly as
 * before. Parses defensively — a null/absent/malformed `metadata_json`, a
 * missing `counterparty`, or a non-numeric commission field all degrade to
 * null (today's $0.00), never a thrown error or a blanked row.
 */
export function billsOnlyCommissionAmount(
  row: TransactionRow,
): { usd: number; lbp: number } | null {
  if (row.type !== "SUPPLIER_SETTLEMENT") return null;
  if (row.amount_usd !== 0 || row.amount_lbp !== 0) return null;
  if (!row.metadata_json) return null;
  try {
    const meta = JSON.parse(row.metadata_json) as {
      commission_model?: unknown;
      commission_usd?: unknown;
      commission_lbp?: unknown;
      counterparty?: { flow?: unknown } | null;
    };
    if (meta.commission_model !== 1) return null;
    if (meta.counterparty?.flow !== "IN") return null;
    const usd =
      typeof meta.commission_usd === "number" ? meta.commission_usd : 0;
    const lbp =
      typeof meta.commission_lbp === "number" ? meta.commission_lbp : 0;
    if (!usd && !lbp) return null;
    return { usd, lbp };
  } catch {
    return null;
  }
}

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
    if (mode === "OTHER_PAYMENT") return "Other payment";
    if (mode !== "TOP_UP") return null;
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
 * (KatchForm bills / FinancialForm catalog units). Voiding a single member
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

/** Maps session ID → hue (0–359) via the golden angle (~137.5°) so any two
 *  sessions stay maximally separated in colour space — no palette cap. */
export function sessionHue(sessionId: number): number {
  return Math.round(Math.abs(sessionId * 137.508)) % 360;
}

/** Inline style carrying the CSS custom property consumed by
 *  `tr[data-session]` rules in index.css. */
export function sessionVars(sessionId: number): CSSProperties {
  return { "--session-hue": sessionHue(sessionId) } as CSSProperties;
}
