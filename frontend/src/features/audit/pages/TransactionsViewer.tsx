import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  Fragment,
  type CSSProperties,
} from "react";
import {
  getRecentTransactions,
  voidTransaction,
  refundTransaction,
  voidCheckoutGroup,
  type TransactionFiltersParam,
} from "@/api/backendApi";
import { DataTable } from "@liratek/ui";
import { FILTER_GROUPS, isSupplierPaymentVisible } from "../auditConstants";
import { isReceiptableRow } from "../receiptGating";
import { isReversibleRow } from "../actionGating";
import {
  getCashFlowDirection,
  isCashTransaction,
  saleTenderTotals,
  formatPaymentLegs,
  type TransactionPaymentLeg,
} from "../cashFlow";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useShopInfo } from "@/hooks/useShopName";
import {
  buildServiceReceiptTextByTransaction,
  getConfiguredReceiptPrinter,
} from "@/shared/utils/serviceReceipt";
import { RECHARGE_SUBTYPE_LABELS } from "@/shared/utils/rechargeLabels";
import { appEvents } from "@liratek/ui";
import { ReceiptPreviewModal } from "@/shared/components/ReceiptPreviewModal";
import { RefundMethodModal } from "../components/RefundMethodModal";
import type { RefundLegOverride } from "../refundLegOverride";

// LIRA-064: structured in/out payment leg joined from the payments table.
// Type + formatting now live in ../cashFlow (Payment-Legs Integrity plan S3 —
// pure logic exported so it's unit-testable without importing this page).

type TransactionRow = {
  id: number;
  type: string;
  status: string;
  source_table: string;
  source_id: number;
  user_id: number;
  amount_usd: number;
  amount_lbp: number;
  exchange_rate: number | null;
  client_id: number | null;
  reverses_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  device_id: string | null;
  created_at: string;
  username: string;
  client_name: string | null;
  // WS8: set when the row belongs to a customer-session basket. Drives the
  // per-session colored left-border accent below. Null for non-session rows.
  session_id: number | null;
  // note 21d: the ACTIVE REFUND row's id that reverses THIS row, or null.
  // The original row stays status=ACTIVE/reverses_id=null after a refund
  // (deliberate — see TransactionRepository), so this is the ONLY signal
  // that tells the UI "already refunded" without the REFUND row itself
  // being loaded on the same page/filter. See actionGating.ts.
  reversed_by_id?: number | null;
  // LIRA-064: structured payment breakdown (may be absent on legacy rows).
  payments?: TransactionPaymentLeg[];
  // CUSTOMER_ACCOUNT settlement of a session basket, sourced from debt_ledger
  // (never written to `payments` — see TransactionWithUser in the backend for
  // why). Kept separate so the cash-only Summary in:/out: line is unaffected;
  // only the Method column should read this.
  account_payments?: TransactionPaymentLeg[];
};

const ALL_OPTIONS = FILTER_GROUPS.flatMap((g) => g.options);

// Transaction types blanket-hidden from the table regardless of any per-row
// metadata: client-activity log noise (CLIENT_CREATED), not useful in the
// operator-facing list by default.
//
// SUPPLIER_PAYMENT used to blanket-hide here too. D2 (CQ-8) replaced that:
// a manual supplier payment is now a first-class visible row and only the
// auto-generated ledger siblings (metadata.is_auto === true) stay hidden by
// default — see isSupplierPaymentVisible (auditConstants.ts), applied
// per-row below since the SQL-level `excludeTypes` can only exclude by
// type, not by metadata.
const HIDDEN_TRANSACTION_TYPES = new Set(["CLIENT_CREATED"]);

// ---------------------------------------------------------------------------
// Type label helpers
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  OMT: "OMT System",
  WHISH: "Whish System",
  OMT_APP: "OMT App",
  WHISH_APP: "Whish App",
  OMT_SYSTEM: "OMT System",
  WHISH_SYSTEM: "Whish System",
  iPick: "iPick",
  Katsh: "Katsh",
  BINANCE: "Binance",
  MTC: "MTC",
  Alfa: "Alfa",
};

const STATIC_TYPE_LABELS: Record<string, string> = {
  LOTO: "Loto",
  LOTO_CASH_PRIZE: "Loto Prize",
  LOTO_MONTHLY_FEE: "Loto Monthly Fee",
  LOTO_SETTLEMENT: "Loto Settlement",
  MTC_TOPUP: "MTC Top-up",
  ALFA_TOPUP: "Alfa Top-up",
  DRAWER_TOPUP: "General Top-up",
  DRAWER_CASHOUT: "General Cash-Out",
  CHECKPOINT: "Checkpoint",
  SUPPLIER_SETTLEMENT: "Supplier Settlement",
  HOLD_MONEY: "Money Held",
  HOLD_MONEY_COLLECT: "Hold Returned",
  CREDIT_CASH_IN: "Account Credit",
  DEBT_CASH_OUT: "Cash Advance",
  PARTNER_SETTLEMENT: "Partner Settlement",
  PARTNER_PAYMENT: "Partner Payment",
  // LIRA-066: the paper (no-cash) "Record Tx" entry.
  PARTNER_ADJUSTMENT: "Partner Adjustment",
  // LIRA-080: the paper (no-cash) Accounts-page "Add Credit / Debt" entry.
  ACCOUNT_ADJUSTMENT: "Account Adjustment",
  // LIRA-080: the paper (no-cash) Suppliers-page "Add Credit / Debt" entry.
  SUPPLIER_ADJUSTMENT: "Supplier Adjustment",
  // CQ-10: one label for all three counterparty kinds (debt/supplier/
  // partner) — the row's metadata.counterparty identifies which.
  COUNTERPARTY_DISCOUNT: "Discount",
};

function getTypeLabel(row: TransactionRow): string {
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

  return STATIC_TYPE_LABELS[row.type] ?? row.type.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Type color helpers
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  SALE: "text-green-400",
  FINANCIAL_SERVICE: "text-blue-400",
  EXCHANGE: "text-yellow-400",
  RECHARGE: "text-purple-400",
  RECHARGE_TOPUP: "text-purple-300",
  MTC_TOPUP: "text-violet-400",
  ALFA_TOPUP: "text-violet-300",
  CUSTOM_SERVICE: "text-cyan-400",
  MAINTENANCE: "text-amber-400",
  EXPENSE: "text-red-400",
  DEBT_REPAYMENT: "text-emerald-400",
  CREDIT_CASH_IN: "text-emerald-400",
  DEBT_CASH_OUT: "text-rose-400",
  SUPPLIER_PAYMENT: "text-indigo-400",
  SUPPLIER_SETTLEMENT: "text-indigo-300",
  // LIRA-080: paper (no-cash) supplier adjustment — one shade lighter than the
  // supplier-payment family (mirrors PARTNER_ADJUSTMENT's sky-200 approach).
  SUPPLIER_ADJUSTMENT: "text-indigo-200",
  // LIRA-080: paper (no-cash) account adjustment — muted emerald, the Accounts
  // family colour (CREDIT_CASH_IN emerald-400) one shade lighter.
  ACCOUNT_ADJUSTMENT: "text-emerald-300",
  // Partners get their own family — teal/cyan are already taken by
  // CLIENT_* (teal) and CUSTOM_SERVICE (cyan), so "sky" keeps them visually
  // distinct while staying in the same cool-hue neighbourhood.
  PARTNER_SETTLEMENT: "text-sky-400",
  PARTNER_PAYMENT: "text-sky-300",
  // LIRA-066: same sky family, one shade lighter — a paper (no-cash) entry.
  PARTNER_ADJUSTMENT: "text-sky-200",
  // CQ-10: fuchsia is otherwise unused — keeps "Discount" visually distinct
  // from every other family (green/blue/purple/indigo/sky/lime/rose/teal…).
  COUNTERPARTY_DISCOUNT: "text-fuchsia-400",
  CHECKPOINT: "text-slate-400",
  LOTO: "text-lime-500",
  LOTO_CASH_PRIZE: "text-lime-400",
  LOTO_MONTHLY_FEE: "text-lime-400",
  LOTO_SETTLEMENT: "text-lime-300",
  DRAWER_TOPUP: "text-slate-300",
  DRAWER_CASHOUT: "text-rose-300",
  HOLD_MONEY: "text-orange-400",
  HOLD_MONEY_COLLECT: "text-orange-300",
  REFUND: "text-rose-400",
  CLIENT_CREATED: "text-teal-400",
  CLIENT_UPDATED: "text-teal-300",
  CLIENT_DELETED: "text-teal-500",
};

function getTypeColor(row: TransactionRow): string {
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
  return TYPE_COLORS[row.type] ?? "text-slate-300";
}

// ---------------------------------------------------------------------------
// Amount formatter
// ---------------------------------------------------------------------------

function formatAmount(
  usd: number,
  lbp: number,
  metaJson?: string | null,
): string {
  const parts: string[] = [];
  if (usd) parts.push(`$${usd.toLocaleString()}`);
  if (lbp) parts.push(`${lbp.toLocaleString()} LBP`);
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
function fallbackMethodLabel(method: string): string {
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
function formatPaymentMethods(
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
function methodLegsFor(row: TransactionRow): TransactionPaymentLeg[] {
  return [...(row.payments ?? []), ...(row.account_payments ?? [])];
}

// ---------------------------------------------------------------------------
// Checkpoint drawer-amount breakdown (shown in the summary column)
// ---------------------------------------------------------------------------

type CheckpointAmountEntry = {
  drawer_name: string;
  currency_code: string;
  physical_amount: number;
};

function formatCheckpointAmounts(metaJson: string | null): string | null {
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

function checkpointPhysicalTotals(
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
function isSupplierCredit(type: string, metaJson?: string | null): boolean {
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
function isSignedPartnerType(type: string): boolean {
  return type === "PARTNER_SETTLEMENT" || type === "PARTNER_PAYMENT";
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
function getSplitGroupInfo(
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

interface CashFlowBadgeProps {
  type: string;
  amountUsd: number;
  amountLbp: number;
  metaJson?: string | null;
}

function CashFlowBadge({
  type,
  amountUsd,
  amountLbp,
  metaJson,
}: CashFlowBadgeProps) {
  // Supplier credit (e.g. a bill commission owed to us): a receivable, not drawer
  // cash. Show a distinct amber "credit" marker instead of the green cash-in
  // arrow, and a positive magnitude (defensive abs for any legacy signed rows).
  if (isSupplierCredit(type, metaJson)) {
    const amountStr = formatAmount(
      Math.abs(amountUsd),
      Math.abs(amountLbp),
      metaJson,
    );
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono">
        <span className="text-amber-400">+</span>
        <span className="text-amber-400">{amountStr}</span>
      </span>
    );
  }

  const direction = getCashFlowDirection(type, metaJson, {
    usd: amountUsd,
    lbp: amountLbp,
  });
  if (!direction) return null;

  // Partner rows carry a signed magnitude (see isSignedPartnerType) — the
  // sign was only needed above to resolve direction; show the plain amount.
  const amountStr = isSignedPartnerType(type)
    ? formatAmount(Math.abs(amountUsd), Math.abs(amountLbp), metaJson)
    : formatAmount(amountUsd, amountLbp, metaJson);

  if (direction === "both") {
    return (
      <span
        data-testid="cash-flow-badge"
        data-direction="both"
        className="inline-flex items-center gap-1 text-[11px] font-mono"
      >
        <span className="text-emerald-400">↓</span>
        <span className="text-emerald-400">/</span>
        <span className="text-red-400">↑</span>
        <span className="text-slate-300">{amountStr}</span>
      </span>
    );
  }

  if (direction === "in") {
    return (
      <span
        data-testid="cash-flow-badge"
        data-direction="in"
        className="inline-flex items-center gap-1 text-[11px] font-mono"
      >
        <span className="text-emerald-400">↓</span>
        <span className="text-emerald-400">{amountStr}</span>
      </span>
    );
  }

  return (
    <span
      data-testid="cash-flow-badge"
      data-direction="out"
      className="inline-flex items-center gap-1 text-[11px] font-mono"
    >
      <span className="text-red-400">↑</span>
      <span className="text-red-400">{amountStr}</span>
    </span>
  );
}

// Void/refund + receipt gating sets live in auditConstants.ts (shared with
// the actionGating guard test that ties them to core's NON_REVERSIBLE set).

// ---------------------------------------------------------------------------
// Per-session left-border accent (WS8)
// ---------------------------------------------------------------------------

/** Maps session ID → hue (0–359) via the golden angle (~137.5°) so any two
 *  sessions stay maximally separated in colour space — no palette cap. */
function sessionHue(sessionId: number): number {
  return Math.round(Math.abs(sessionId * 137.508)) % 360;
}

/** Inline style carrying the CSS custom property consumed by
 *  `tr[data-session]` rules in index.css. */
function sessionVars(sessionId: number): CSSProperties {
  return { "--session-hue": sessionHue(sessionId) } as CSSProperties;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TransactionsViewerProps {
  limit: string;
  selectedFilter: string;
  search: string;
  from: string;
  to: string;
}

export default function TransactionsViewer({
  limit,
  selectedFilter,
  search,
  from,
  to,
}: TransactionsViewerProps) {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const shopInfo = useShopInfo();

  const { methods: paymentMethods, drawerAffectingMethods } =
    usePaymentMethods();
  const methodLabelByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of paymentMethods) map.set(m.code, m.label);
    return map;
  }, [paymentMethods]);

  const filteredData = useMemo(() => {
    if (!from && !to) return rows;
    return rows.filter((row) => {
      const dateVal = (row.created_at ?? "").slice(0, 10);
      if (from && dateVal < from) return false;
      if (to && dateVal > to) return false;
      return true;
    });
  }, [rows, from, to]);

  // Detect rows that are "sandwiched" between the first and last row of the
  // same session. These are auto-generated system transactions (e.g.
  // SUPPLIER_PAYMENT) that have no session_id of their own but logically belong
  // to the session. Detection is order-independent: a non-session row is
  // sandwiched when its id falls strictly between the min and max id of any
  // session's rows.
  // The "System Transactions" fold/button is disabled: the system rows it
  // used to collapse (chiefly auto-generated SUPPLIER_PAYMENT siblings) are
  // hidden by default via the per-row D2 rule (see isSupplierPaymentVisible/
  // filterVisible below) or CLIENT_CREATED's blanket HIDDEN_TRANSACTION_TYPES
  // hide, so any remaining non-session rows just render inline. An empty map
  // means no row is treated as sandwiched, so the ⚙ toggle never appears in
  // the session-grouped view.
  const sandwichedMap = useMemo(() => new Map<number, number>(), []);

  // For each session's sandwiched group: how many rows, and which has the
  // highest id (= the one shown first in the default created_at DESC sort,
  // where we render the fold toggle).
  const sandwichMeta = useMemo(() => {
    const firstId = new Map<number, number>(); // sessionId → max rowId
    const count = new Map<number, number>(); // sessionId → count
    for (const [rowId, sessionId] of sandwichedMap) {
      count.set(sessionId, (count.get(sessionId) ?? 0) + 1);
      const cur = firstId.get(sessionId);
      if (cur === undefined || rowId > cur) firstId.set(sessionId, rowId);
    }
    return { firstId, count };
  }, [sandwichedMap]);

  const [expandedSessions, setExpandedSessions] = useState<Set<number>>(
    new Set(),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const activeOption = ALL_OPTIONS.find((o) => o.label === selectedFilter);
      const filters: TransactionFiltersParam = {};
      if (activeOption?.type) filters.type = activeOption.type;
      if (activeOption?.provider) filters.provider = activeOption.provider;
      if (activeOption?.service_type)
        filters.service_type = activeOption.service_type;
      if (activeOption?.has_item_key !== undefined)
        filters.has_item_key = activeOption.has_item_key;
      if (search) filters.search = search;

      // Exclude the always-hidden types at the SQL level so LIMIT is applied
      // to already-filtered rows — a burst of hidden-type rows (e.g. hundreds
      // of CLIENT_CREATED from a bulk import) can no longer crowd genuinely
      // visible rows out of the result window. CLIENT_CREATED is the only
      // type that's safe to exclude here: its hide/show is never conditional
      // on per-row metadata. SUPPLIER_PAYMENT (D2) is NOT excluded — whether
      // a given row shows depends on metadata.is_auto, which the SQL filter
      // can't see, so that decision is made entirely client-side below.
      filters.excludeTypes = Array.from(HIDDEN_TRANSACTION_TYPES);

      const requested = Number(limit) || 50;
      const filterVisible = (rows: TransactionRow[]) => {
        let vis = rows.filter((r) => {
          if (HIDDEN_TRANSACTION_TYPES.has(r.type)) return false;
          if (r.type === "SUPPLIER_PAYMENT") {
            return isSupplierPaymentVisible(r.metadata_json, activeOption);
          }
          return true;
        });
        // B6: "Cash only (till)" — keep transactions with a CASH payment leg.
        if (activeOption?.cash_only) {
          vis = vis.filter((r) => isCashTransaction(r.payments));
        }
        return vis;
      };

      // The SQL exclusion only covers CLIENT_CREATED now. The per-row
      // JS-only filters above (SUPPLIER_PAYMENT's is_auto/is_credit checks,
      // Cash Only's joined payment legs) can under-fill a window — a run of
      // auto-generated supplier rows is the same "crowds out real rows"
      // risk CLIENT_CREATED bulk-imports posed pre-D2 — so keep widening the
      // fetch until it's satisfied or the table is exhausted (raw came back
      // shorter than what we asked for).
      let fetchSize = requested * 3;
      const FETCH_CAP = Math.max(fetchSize, 5000);
      let visible: TransactionRow[] = [];
      for (;;) {
        const raw = ((await getRecentTransactions(fetchSize, filters)) ||
          []) as TransactionRow[];
        visible = filterVisible(raw);
        if (
          visible.length >= requested ||
          raw.length < fetchSize ||
          fetchSize >= FETCH_CAP
        ) {
          break;
        }
        fetchSize *= 3;
      }
      setRows(visible.slice(0, requested));
    } finally {
      setLoading(false);
    }
  }, [limit, selectedFilter, search]);

  // Print button opens an in-app preview first (same UX as the POS
  // CheckoutModal's "Receipt Preview") instead of invoking the OS print
  // flow directly — the modal's own Print button does that.
  const [receiptPreview, setReceiptPreview] = useState<{
    text: string;
    printer: string;
  } | null>(null);

  const handlePrintReceipt = useCallback(
    async (id: number) => {
      const built = await buildServiceReceiptTextByTransaction(id, shopInfo);
      if (!built.ok || !built.text) {
        appEvents.emit(
          "notification:show",
          "Could not print receipt: " + (built.error || "Unknown error"),
          "error",
        );
        return;
      }
      const printer = await getConfiguredReceiptPrinter();
      setReceiptPreview({ text: built.text, printer });
    },
    [shopInfo],
  );

  const handleVoid = useCallback(
    async (id: number) => {
      if (!confirm("Void this transaction? This cannot be undone.")) return;
      try {
        const res = await voidTransaction(id);
        if (res.success) load();
        else alert("Failed: " + (res.error || "Unknown error"));
      } catch {
        alert("Failed to void transaction");
      }
    },
    [load],
  );

  const doRefund = useCallback(
    async (id: number, refundLegs?: RefundLegOverride[]) => {
      try {
        const res = await refundTransaction(id, refundLegs);
        if (res.success) load();
        else alert("Failed: " + (res.error || "Unknown error"));
      } catch {
        alert("Failed to refund transaction");
      }
    },
    [load],
  );

  // LIRA-078: the modal that lets the operator choose the refund's return
  // method(s), open for at most one row at a time.
  const [refundModalRow, setRefundModalRow] = useState<TransactionRow | null>(
    null,
  );
  const [isRefunding, setIsRefunding] = useState(false);

  const handleRefund = useCallback(
    (row: TransactionRow) => {
      // Two cases fall back to the plain bare-reversal refund (today's exact
      // behavior, no modal) instead of opening the tender-selection modal:
      //   - no customer-facing legs at all (nothing to override — a scripted/
      //     legacy row, or a type whose reversal is drawer-only internally);
      //   - a session-basket row. `TransactionRepository._attachPaymentLegs`
      //     lets a session member with no OWN legs inherit the basket's
      //     session-scoped legs (posted with session_id set, transaction_id
      //     NULL) for DISPLAY — but the backend's per-transaction validation
      //     (`getCustomerFacingLegs`/`_validateRefundLegOverride`, keyed on
      //     transaction_id) would see an EMPTY set for that same row and reject
      //     any override with a confusing "nothing to refund" error. Documented
      //     out of scope alongside split_group (session-basket refund-by-
      //     method-override needing an owner decision on which member "owns"
      //     the basket's legs is a follow-up, not this ticket).
      if (
        row.session_id != null ||
        !row.payments ||
        row.payments.length === 0
      ) {
        if (
          !confirm("Refund this transaction? A reversal entry will be created.")
        )
          return;
        void doRefund(row.id);
        return;
      }
      setRefundModalRow(row);
    },
    [doRefund],
  );

  const handleConfirmRefundOverride = useCallback(
    async (refundLegs: RefundLegOverride[] | undefined) => {
      if (!refundModalRow) return;
      setIsRefunding(true);
      try {
        await doRefund(refundModalRow.id, refundLegs);
      } finally {
        setIsRefunding(false);
        setRefundModalRow(null);
      }
    },
    [refundModalRow, doRefund],
  );

  /**
   * CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): void every non-voided member
   * of the multi-unit split checkout in ONE transaction. This is the ONLY
   * void action offered on a split_group row — a lone member's void/refund
   * throws the repository guard's error, so it is never wired to a button.
   */
  const handleVoidCheckoutGroup = useCallback(
    async (groupId: string, units: number | null) => {
      const label = units ? `${units}-unit` : "multi-unit";
      if (
        !confirm(
          `Void the entire ${label} checkout? Every unit's money, cost, and profit will be reversed. This cannot be undone.`,
        )
      )
        return;
      try {
        const res = await voidCheckoutGroup(groupId);
        if (res.success) load();
        else alert("Failed: " + (res.error || "Unknown error"));
      } catch {
        alert("Failed to void checkout group");
      }
    },
    [load],
  );

  useEffect(() => {
    load();
  }, [load]);

  function toggleSandwich(sessionId: number) {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  // Renders a full data <tr> for a transaction row. Pass sessionId to apply
  // the session accent (data-session + --session-hue); pass null for plain rows.
  // isSystem=true applies muted styling for collapsed system sub-rows.
  function buildTr(
    row: TransactionRow,
    sessionId: number | null,
    trKey?: string | number,
    isSystem?: boolean,
  ) {
    const credit = isSupplierCredit(row.type, row.metadata_json);
    const partnerSigned = isSignedPartnerType(row.type);
    const tender = saleTenderTotals(row.type, row.payments);
    const splitGroup = getSplitGroupInfo(row.metadata_json);
    return (
      <tr
        key={trKey ?? row.id}
        data-session={sessionId != null ? "" : undefined}
        style={sessionId != null ? sessionVars(sessionId) : undefined}
        className={`border-t border-slate-800 text-xs ${row.status === "VOIDED" ? "bg-red-950/20" : isSystem ? "bg-slate-900/40 opacity-75" : ""}`}
      >
        <td className="p-2 truncate" style={{ width: 160 }}>
          {row.created_at
            ? (() => {
                try {
                  return parseDbDate(row.created_at).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                } catch {
                  return row.created_at;
                }
              })()
            : ""}
        </td>
        <td className="p-2">
          <div className="flex flex-col gap-0.5">
            <CashFlowBadge
              type={row.type}
              amountUsd={tender?.usd ?? row.amount_usd}
              amountLbp={tender?.lbp ?? row.amount_lbp}
              metaJson={row.metadata_json}
            />
            {row.summary && (
              <span className="text-slate-400 truncate max-w-[480px]">
                {row.summary}
              </span>
            )}
            {row.type === "CHECKPOINT" &&
              (() => {
                const amountDetail = formatCheckpointAmounts(row.metadata_json);
                if (!amountDetail) return null;
                return (
                  <span className="text-[10px] font-mono text-slate-500 truncate max-w-[480px]">
                    {amountDetail}
                  </span>
                );
              })()}
            {row.type !== "CHECKPOINT" &&
              (() => {
                const legs = formatPaymentLegs(row.payments);
                const rate = row.exchange_rate
                  ? `@ ${Math.round(row.exchange_rate).toLocaleString()}`
                  : null;
                const text = [legs, rate].filter(Boolean).join(" · ");
                if (!text) return null;
                return (
                  <span
                    data-testid="payment-legs"
                    className="text-[11px] font-mono text-slate-500 truncate max-w-[480px]"
                  >
                    {text}
                  </span>
                );
              })()}
          </div>
        </td>
        <td className="p-2 truncate" style={{ width: 160 }}>
          <span
            className={`${getTypeColor(row)} ${row.status === "VOIDED" ? "line-through opacity-60" : ""}`}
          >
            {getTypeLabel(row)}
          </span>
        </td>
        <td className="p-2 truncate" style={{ width: 140 }}>
          {row.client_name || "—"}
        </td>
        <td className="p-2 truncate" style={{ width: 160 }}>
          <span
            className={row.status === "VOIDED" ? "line-through opacity-60" : ""}
          >
            {row.type === "CHECKPOINT"
              ? (() => {
                  const totals = checkpointPhysicalTotals(row.metadata_json);
                  return formatAmount(
                    totals?.usd ?? row.amount_usd,
                    totals?.lbp ?? row.amount_lbp,
                    null,
                  );
                })()
              : formatAmount(
                  tender?.usd ??
                    (credit || partnerSigned
                      ? Math.abs(row.amount_usd)
                      : row.amount_usd),
                  tender?.lbp ??
                    (credit || partnerSigned
                      ? Math.abs(row.amount_lbp)
                      : row.amount_lbp),
                  row.metadata_json,
                )}
          </span>
        </td>
        <td className="p-2 truncate" style={{ width: 120 }}>
          {row.type === "CHECKPOINT"
            ? "—"
            : formatPaymentMethods(methodLegsFor(row), methodLabelByCode)}
        </td>
        <td className="p-2 truncate" style={{ width: 90 }}>
          {row.username || `#${row.user_id}`}
        </td>
        <td className="p-2" style={{ width: 80 }}>
          {row.status === "VOIDED" ? (
            <span className="bg-red-900/50 text-red-300 text-[10px] px-1.5 py-0.5 rounded font-medium">
              VOIDED
            </span>
          ) : row.reversed_by_id ? (
            // note 21d: an ACTIVE original that has already been refunded —
            // gets the same small badge treatment as VOIDED (and, below,
            // loses its Void/Refund buttons the same way), but deliberately
            // NOT the line-through styling VOIDED rows get on the
            // type/summary cells: a void means "this transaction is
            // cancelled, its amount doesn't count" (the source record itself
            // is voided), whereas a refunded row's sale/service genuinely
            // happened — the amount stays real history, only the money was
            // reversed via a separate REFUND row. Badge-only, distinct color
            // so the two states still read apart.
            <span className="bg-rose-900/50 text-rose-300 text-[10px] px-1.5 py-0.5 rounded font-medium">
              REFUNDED
            </span>
          ) : (
            <span className="text-green-500/80 text-[10px] font-medium">
              ACTIVE
            </span>
          )}
        </td>
        <td className="p-2" style={{ width: 60 }}>
          {row.reverses_id ? `#${row.reverses_id}` : "—"}
        </td>
        <td className="p-2" style={{ width: 110 }}>
          <div className="flex items-center gap-1">
            {/* Reprint a detailed service receipt (RCP-3) — available on any
                service transaction, including voided/older ones. Provider-
                aware gate (LIRA-069 W1.a) — excludes OMT/Whish System,
                OMT App / Whish App transfers, and Binance even though
                they're FINANCIAL_SERVICE rows. */}
            {isReceiptableRow(row) && (
              <button
                onClick={() => handlePrintReceipt(row.id)}
                title="Print receipt"
                className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
              >
                Print
              </button>
            )}
            {isReversibleRow(row) ? (
              splitGroup ? (
                // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): this row is one
                // unit of a multi-unit split checkout — a lone void/refund is
                // blocked by the repository guard (the customer's full
                // tender/debt books against only ONE unit, the carrier).
                // Offer the whole-checkout action instead of a button that
                // would just surface the guard's error.
                <button
                  onClick={() =>
                    handleVoidCheckoutGroup(
                      splitGroup.groupId,
                      splitGroup.units,
                    )
                  }
                  title="This transaction is part of a multi-unit checkout — void them all together"
                  className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
                >
                  Void entire checkout
                  {splitGroup.units ? ` (${splitGroup.units} units)` : ""}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleVoid(row.id)}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
                  >
                    Void
                  </button>
                  <button
                    onClick={() => handleRefund(row)}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/70 text-rose-200 hover:bg-rose-900/40 hover:text-rose-300 transition-colors"
                  >
                    Refund
                  </button>
                </>
              )
            ) : isReceiptableRow(row) ? null : (
              "—"
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <DataTable<TransactionRow>
        columns={[
          {
            header: "Time",
            sortKey: "created_at",
            width: "160px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Summary",
            sortKey: "summary",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Type",
            sortKey: "type",
            width: "160px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Client",
            sortKey: "client_name",
            width: "140px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Amount",
            sortKey: "amount_usd",
            width: "160px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Method",
            sortKey: "payment_method",
            width: "120px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "User",
            sortKey: "username",
            width: "90px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Status",
            sortKey: "status",
            width: "80px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Reverses",
            sortKey: "reverses_id",
            width: "60px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Actions",
            width: "80px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
        ]}
        data={filteredData}
        loading={loading}
        emptyMessage="No transactions found"
        defaultSortKey="created_at"
        defaultSortDirection="desc"
        showRowCount
        totalRowCount={rows.length}
        exportExcel
        exportPdf
        exportFilename="transactions"
        className="w-full text-left"
        theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
        tbodyClassName=""
        getSortValue={(row, key) => {
          if (key === "created_at")
            return row.created_at ? parseDbDate(row.created_at).getTime() : 0;
          if (key === "amount_usd") return row.amount_usd ?? 0;
          if (key === "reverses_id") return row.reverses_id ?? 0;
          if (key === "payment_method")
            return formatPaymentMethods(methodLegsFor(row), methodLabelByCode);
          return String((row as Record<string, unknown>)[key] ?? "");
        }}
        exportRow={(row) => {
          if (sandwichedMap.has(row.id)) return null;
          return buildTr(row, row.session_id);
        }}
        renderRow={(row) => {
          const sandwichedSession = sandwichedMap.get(row.id);

          if (sandwichedSession != null) {
            const isExpanded = expandedSessions.has(sandwichedSession);
            const isFirst =
              row.id === sandwichMeta.firstId.get(sandwichedSession);
            const cnt = sandwichMeta.count.get(sandwichedSession) ?? 0;

            if (!isExpanded) {
              // First sandwiched row in collapsed group →
              // 1px spacer row; badge floats absolutely at the left border.
              if (isFirst) {
                return (
                  <tr
                    key={row.id}
                    data-session=""
                    style={sessionVars(sandwichedSession)}
                  >
                    <td
                      colSpan={10}
                      style={{
                        padding: 0,
                        height: "1px",
                        lineHeight: "1px",
                        overflow: "visible",
                        position: "relative",
                        borderTop: "1px solid rgba(30,41,59,0.35)",
                      }}
                    >
                      <button
                        onClick={() => toggleSandwich(sandwichedSession)}
                        style={{
                          position: "absolute",
                          left: "6px",
                          top: 0,
                          transform: "translateY(-50%)",
                          zIndex: 10,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                          padding: "1px 6px",
                          borderRadius: "9999px",
                          background:
                            "hsla(var(--session-hue), 78%, 62%, 0.15)",
                          border:
                            "1px solid hsla(var(--session-hue), 78%, 62%, 0.45)",
                          color: "hsla(var(--session-hue), 78%, 62%, 0.9)",
                          fontSize: "9px",
                          fontFamily: "monospace",
                          cursor: "pointer",
                          lineHeight: "1.4",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span>⚙</span>
                        <span>+{cnt}</span>
                      </button>
                    </td>
                  </tr>
                );
              }
              // Other sandwiched rows in collapsed group → invisible placeholder
              return (
                <tr key={row.id} style={{ display: "none" }}>
                  <td />
                </tr>
              );
            }

            // Expanded — same 1px spacer with a "collapse" badge, then the data rows
            if (isFirst) {
              return (
                <Fragment key={row.id}>
                  <tr
                    key={`stoggle-${sandwichedSession}`}
                    data-session=""
                    style={sessionVars(sandwichedSession)}
                  >
                    <td
                      colSpan={10}
                      style={{
                        padding: 0,
                        height: "1px",
                        lineHeight: "1px",
                        overflow: "visible",
                        position: "relative",
                        borderTop: "1px solid rgba(30,41,59,0.35)",
                      }}
                    >
                      <button
                        onClick={() => toggleSandwich(sandwichedSession)}
                        style={{
                          position: "absolute",
                          left: "6px",
                          top: 0,
                          transform: "translateY(-50%)",
                          zIndex: 10,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                          padding: "1px 6px",
                          borderRadius: "9999px",
                          background:
                            "hsla(var(--session-hue), 78%, 62%, 0.15)",
                          border:
                            "1px solid hsla(var(--session-hue), 78%, 62%, 0.45)",
                          color: "hsla(var(--session-hue), 78%, 62%, 0.9)",
                          fontSize: "9px",
                          fontFamily: "monospace",
                          cursor: "pointer",
                          lineHeight: "1.4",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span>⚙</span>
                        <span>-{cnt}</span>
                      </button>
                    </td>
                  </tr>
                  {buildTr(row, sandwichedSession, `data-${row.id}`, true)}
                </Fragment>
              );
            }
            // Other expanded sandwiched rows → full data row with system mute styling
            return buildTr(row, sandwichedSession, undefined, true);
          }

          // Regular row — session accent applied if it belongs to a session
          return buildTr(row, row.session_id);
        }}
      />
      {refundModalRow && (
        <RefundMethodModal
          legs={refundModalRow.payments ?? []}
          paymentMethods={drawerAffectingMethods.map((m) => ({
            code: m.code,
            label: m.label,
          }))}
          exchangeRate={refundModalRow.exchange_rate ?? 89000}
          isSubmitting={isRefunding}
          onCancel={() => setRefundModalRow(null)}
          onConfirm={handleConfirmRefundOverride}
        />
      )}
      {receiptPreview && (
        <ReceiptPreviewModal
          text={receiptPreview.text}
          printer={receiptPreview.printer}
          logo={shopInfo.logo}
          onClose={() => setReceiptPreview(null)}
        />
      )}
    </>
  );
}
