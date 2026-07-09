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
  type TransactionFiltersParam,
} from "@/api/backendApi";
import { DataTable } from "@liratek/ui";
import { FILTER_GROUPS } from "../auditConstants";
import { getCashFlowDirection, isCashTransaction } from "../cashFlow";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";

// LIRA-064: structured in/out payment leg joined from the payments table.
// Mirrors TransactionPaymentLeg in the backend / electron.d.ts. The data is
// returned by the backend; we only format/join it client-side here.
type TransactionPaymentLeg = {
  direction: "in" | "out";
  amount: number;
  signed_amount: number;
  currency_code: string;
  method: string;
};

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
  // LIRA-064: structured payment breakdown (may be absent on legacy rows).
  payments?: TransactionPaymentLeg[];
  // CUSTOMER_ACCOUNT settlement of a session basket, sourced from debt_ledger
  // (never written to `payments` — see TransactionWithUser in the backend for
  // why). Kept separate so the cash-only Summary in:/out: line is unaffected;
  // only the Method column should read this.
  account_payments?: TransactionPaymentLeg[];
};

const ALL_OPTIONS = FILTER_GROUPS.flatMap((g) => g.options);

// Transaction types hidden from the table by default: auto-generated
// supplier-ledger payment siblings (SUPPLIER_PAYMENT, including the is_credit
// "Supplier Credit" rows) and client-activity log noise (CLIENT_CREATED),
// neither useful in the operator-facing list by default. SUPPLIER_PAYMENT is
// still reachable via the dedicated "Supplier Credit" filter option (see
// auditConstants FILTER_GROUPS) — the load filter below only un-hides it when
// that option is explicitly selected.
const HIDDEN_TRANSACTION_TYPES = new Set(["SUPPLIER_PAYMENT", "CLIENT_CREATED"]);

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

const RECHARGE_SUBTYPE_LABELS: Record<string, string> = {
  CREDIT_TRANSFER: "Credits",
  VOUCHER: "Voucher",
  DAYS: "Days",
  TOP_UP: "Top-up",
  ALFA_GIFT: "Gift",
};

const STATIC_TYPE_LABELS: Record<string, string> = {
  LOTO: "Loto",
  LOTO_CASH_PRIZE: "Loto Prize",
  LOTO_MONTHLY_FEE: "Loto Monthly Fee",
  LOTO_SETTLEMENT: "Loto Settlement",
  MTC_TOPUP: "MTC Top-up",
  ALFA_TOPUP: "Alfa Top-up",
  DRAWER_TOPUP: "General Top-up",
  CHECKPOINT: "Checkpoint",
  SUPPLIER_SETTLEMENT: "Supplier Settlement",
  HOLD_MONEY: "Money Held",
  HOLD_MONEY_COLLECT: "Hold Returned",
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
      if ((p === "iPick" || p === "Katsh") && st === "BILL") return `${base} Bill`;
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
  SUPPLIER_PAYMENT: "text-indigo-400",
  SUPPLIER_SETTLEMENT: "text-indigo-300",
  CHECKPOINT: "text-slate-400",
  LOTO: "text-lime-500",
  LOTO_CASH_PRIZE: "text-lime-400",
  LOTO_MONTHLY_FEE: "text-lime-400",
  LOTO_SETTLEMENT: "text-lime-300",
  DRAWER_TOPUP: "text-slate-300",
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
// Structured payment legs (LIRA-064)
// ---------------------------------------------------------------------------

/** Format a single payment amount with its currency, e.g. "$50" or "100,000 LBP". */
function formatLegAmount(leg: TransactionPaymentLeg): string {
  const value = leg.amount.toLocaleString();
  return leg.currency_code === "USD"
    ? `$${value}`
    : `${value} ${leg.currency_code}`;
}

/**
 * Build the "in: ... · out: ..." string from the structured payment legs,
 * joined entirely client-side. Returns null when there are no legs so callers
 * can skip rendering. Same-currency legs on the same side are summed so the
 * label stays compact (e.g. two USD cash legs → one "$50").
 */
function formatPaymentLegs(
  legs: TransactionPaymentLeg[] | undefined,
): string | null {
  if (!legs || legs.length === 0) return null;

  const sumByCurrency = (side: "in" | "out"): string[] => {
    const totals = new Map<string, number>();
    for (const leg of legs) {
      if (leg.direction !== side) continue;
      totals.set(
        leg.currency_code,
        (totals.get(leg.currency_code) ?? 0) + leg.amount,
      );
    }
    return [...totals.entries()].map(([currency_code, amount]) =>
      formatLegAmount({
        direction: side,
        amount,
        signed_amount: amount,
        currency_code,
        method: "",
      }),
    );
  };

  const inParts = sumByCurrency("in");
  const outParts = sumByCurrency("out");

  const segments: string[] = [];
  if (inParts.length) segments.push(`in: ${inParts.join(" + ")}`);
  if (outParts.length) segments.push(`out: ${outParts.join(" + ")}`);

  return segments.length ? segments.join(" · ") : null;
}

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

  const direction = getCashFlowDirection(type, metaJson);
  if (!direction) return null;

  const amountStr = formatAmount(amountUsd, amountLbp, metaJson);

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

// ---------------------------------------------------------------------------
// Actionable types (void / refund buttons)
// ---------------------------------------------------------------------------

const ACTIONABLE_TYPES = new Set([
  "SALE",
  "FINANCIAL_SERVICE",
  "EXCHANGE",
  "BINANCE",
  "RECHARGE",
  "CUSTOM_SERVICE",
  "MAINTENANCE",
  "EXPENSE",
  "DEBT_REPAYMENT",
  "SUPPLIER_PAYMENT",
]);

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

  const { methods: paymentMethods } = usePaymentMethods();
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
  // The "System Transactions" fold/button is disabled: the system rows it used
  // to collapse (chiefly SUPPLIER_PAYMENT) are now hidden outright via
  // HIDDEN_TRANSACTION_TYPES, so any remaining non-session rows just render
  // inline. An empty map means no row is treated as sandwiched, so the ⚙ toggle
  // never appears in the session-grouped view.
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
      // visible rows out of the result window. "Supplier Credit" is the one
      // deliberate exception: it needs SUPPLIER_PAYMENT rows to stay in the
      // raw result so it can narrow them down to just the is_credit ones.
      filters.excludeTypes = activeOption?.supplier_credit_only
        ? ["CLIENT_CREATED"]
        : Array.from(HIDDEN_TRANSACTION_TYPES);

      const requested = Number(limit) || 50;
      const filterVisible = (rows: TransactionRow[]) => {
        let vis = rows.filter((r) => {
          if (!HIDDEN_TRANSACTION_TYPES.has(r.type)) return true;
          return (
            !!activeOption?.supplier_credit_only &&
            isSupplierCredit(r.type, r.metadata_json)
          );
        });
        // B6: "Cash only (till)" — keep transactions with a CASH payment leg.
        if (activeOption?.cash_only) {
          vis = vis.filter((r) => isCashTransaction(r.payments));
        }
        return vis;
      };

      // The SQL exclusion covers the default case in one round-trip. The two
      // remaining JS-only filters above (Supplier Credit's is_credit check,
      // Cash Only's joined payment legs) can still under-fill a window, so
      // keep widening the fetch until it's satisfied or the table is
      // exhausted (raw came back shorter than what we asked for).
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

  const handleRefund = useCallback(
    async (id: number) => {
      if (
        !confirm("Refund this transaction? A reversal entry will be created.")
      )
        return;
      try {
        const res = await refundTransaction(id);
        if (res.success) load();
        else alert("Failed: " + (res.error || "Unknown error"));
      } catch {
        alert("Failed to refund transaction");
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
              amountUsd={row.amount_usd}
              amountLbp={row.amount_lbp}
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
                  credit ? Math.abs(row.amount_usd) : row.amount_usd,
                  credit ? Math.abs(row.amount_lbp) : row.amount_lbp,
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
          ) : (
            <span className="text-green-500/80 text-[10px] font-medium">
              ACTIVE
            </span>
          )}
        </td>
        <td className="p-2" style={{ width: 60 }}>
          {row.reverses_id ? `#${row.reverses_id}` : "—"}
        </td>
        <td className="p-2" style={{ width: 80 }}>
          {ACTIONABLE_TYPES.has(row.type) &&
          row.status !== "VOIDED" &&
          row.type !== "REFUND" &&
          !row.reverses_id ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleVoid(row.id)}
                className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
              >
                Void
              </button>
              <button
                onClick={() => handleRefund(row.id)}
                className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/70 text-rose-200 hover:bg-rose-900/40 hover:text-rose-300 transition-colors"
              >
                Refund
              </button>
            </div>
          ) : (
            "—"
          )}
        </td>
      </tr>
    );
  }

  return (
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
                        background: "hsla(var(--session-hue), 78%, 62%, 0.15)",
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
                        background: "hsla(var(--session-hue), 78%, 62%, 0.15)",
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
  );
}
