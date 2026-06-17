import { useEffect, useState, useCallback, useMemo } from "react";
import {
  getRecentTransactions,
  voidTransaction,
  refundTransaction,
  type TransactionFiltersParam,
} from "@/api/backendApi";
import { DataTable } from "@liratek/ui";
import { FILTER_GROUPS } from "../auditConstants";

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
  // LIRA-064: structured payment breakdown (may be absent on legacy rows).
  payments?: TransactionPaymentLeg[];
};

const ALL_OPTIONS = FILTER_GROUPS.flatMap((g) => g.options);

// ---------------------------------------------------------------------------
// Type label helpers
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  OMT: "OMT System",
  WHISH: "Whish System",
  OMT_APP: "OMT App",
  WISH_APP: "Whish App",
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
  CHECKPOINT: "Closing",
  SUPPLIER_SETTLEMENT: "Supplier Settlement",
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
      if (p === "OMT_APP" || p === "BINANCE" || (p === "WISH_APP" && !ik)) {
        if (st === "SEND") return `${base} Send`;
        if (st === "RECEIVE") return `${base} Recv`;
      }
      if (p === "WISH_APP" && ik) return "Whish App Bills";
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
        case "WISH_APP":
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
  return TYPE_COLORS[row.type] ?? "text-slate-300";
}

// ---------------------------------------------------------------------------
// Amount formatter
// ---------------------------------------------------------------------------

function formatAmount(usd: number, lbp: number, metaJson?: string | null): string {
  const parts: string[] = [];
  if (usd) parts.push(`$${usd.toLocaleString()}`);
  if (lbp) parts.push(`${lbp.toLocaleString()} LBP`);
  if (!parts.length && metaJson) {
    try {
      const meta = JSON.parse(metaJson) as Record<string, unknown>;
      const amt = meta.amount;
      const cur = meta.currency;
      if (typeof amt === "number" && amt && typeof cur === "string" && cur !== "USD") {
        parts.push(`${amt.toFixed(2)} ${cur}`);
      }
    } catch { /* ignore */ }
  }
  return parts.join(" + ") || "—";
}

// ---------------------------------------------------------------------------
// Structured payment legs (LIRA-064)
// ---------------------------------------------------------------------------

/** Format a single payment amount with its currency, e.g. "$50" or "100,000 LBP". */
function formatLegAmount(leg: TransactionPaymentLeg): string {
  const value = leg.amount.toLocaleString();
  return leg.currency_code === "USD" ? `$${value}` : `${value} ${leg.currency_code}`;
}

/**
 * Build the "in: ... · out: ..." string from the structured payment legs,
 * joined entirely client-side. Returns null when there are no legs so callers
 * can skip rendering. Same-currency legs on the same side are summed so the
 * label stays compact (e.g. two USD cash legs → one "$50").
 */
function formatPaymentLegs(legs: TransactionPaymentLeg[] | undefined): string | null {
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

// ---------------------------------------------------------------------------
// Cash flow direction
// ---------------------------------------------------------------------------

function getCashFlowDirection(
  type: string,
  metaJson?: string | null,
): "in" | "out" | "both" | null {
  switch (type) {
    case "SALE":
    case "FINANCIAL_SERVICE":
    case "RECHARGE":
    case "CUSTOM_SERVICE":
    case "MAINTENANCE":
    case "DEBT_REPAYMENT":
    case "SUPPLIER_PAYMENT":
    case "MTC_TOPUP":
    case "ALFA_TOPUP":
      return "in";
    case "RECHARGE_TOPUP": {
      // RECHARGE_TOPUP covers two opposite flows. The classic "from drawer"
      // top-up spends cash (out). But Whish App credit-acquisition top-ups —
      // funded by a partner (partnerId) or bought from a client (cashPaid) —
      // increase the provider drawer, so they are inflows (like MTC/ALFA_TOPUP).
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as {
            partnerId?: number | null;
            cashPaid?: number | null;
          };
          if (m.partnerId != null || m.cashPaid != null) return "in";
        } catch {
          /* fall through to default "out" */
        }
      }
      return "out";
    }
    case "EXPENSE":
    case "LOTO_MONTHLY_FEE":
    case "LOTO_SETTLEMENT":
    case "SUPPLIER_SETTLEMENT":
      return "out";
    case "EXCHANGE":
      return "both";
    default:
      return null;
  }
}

interface CashFlowBadgeProps {
  type: string;
  amountUsd: number;
  amountLbp: number;
  metaJson?: string | null;
}

function CashFlowBadge({ type, amountUsd, amountLbp, metaJson }: CashFlowBadgeProps) {
  const direction = getCashFlowDirection(type, metaJson);
  if (!direction) return null;

  const amountStr = formatAmount(amountUsd, amountLbp, metaJson);

  if (direction === "both") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono">
        <span className="text-emerald-400">↓</span>
        <span className="text-emerald-400">/</span>
        <span className="text-red-400">↑</span>
        <span className="text-slate-300">{amountStr}</span>
      </span>
    );
  }

  if (direction === "in") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono">
        <span className="text-emerald-400">↓</span>
        <span className="text-emerald-400">{amountStr}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono">
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

  const filteredData = useMemo(() => {
    if (!from && !to) return rows;
    return rows.filter((row) => {
      const dateVal = (row.created_at ?? "").slice(0, 10);
      if (from && dateVal < from) return false;
      if (to && dateVal > to) return false;
      return true;
    });
  }, [rows, from, to]);

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

      const res = await getRecentTransactions(Number(limit) || 50, filters);
      setRows((res as TransactionRow[]) || []);
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
          return row.created_at ? new Date(row.created_at).getTime() : 0;
        if (key === "amount_usd") return row.amount_usd ?? 0;
        if (key === "reverses_id") return row.reverses_id ?? 0;
        return String((row as Record<string, unknown>)[key] ?? "");
      }}
      renderRow={(row) => (
        <tr
          key={row.id}
          className={`border-t border-slate-800 text-xs ${row.status === "VOIDED" ? "bg-red-950/20" : ""}`}
        >
          <td className="p-2 truncate" style={{ width: 160 }}>
            {row.created_at
              ? (() => {
                  try {
                    return new Date(row.created_at).toLocaleString(
                      "en-GB",
                      {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    );
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
              {(() => {
                // LIRA-064: structured in/out payment legs, joined client-side,
                // with the transaction's USD→LBP rate-of-record appended.
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
              className={
                row.status === "VOIDED" ? "line-through opacity-60" : ""
              }
            >
              {formatAmount(row.amount_usd, row.amount_lbp, row.metadata_json)}
            </span>
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
            row.type !== "REFUND" ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleVoid(row.id)}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/40 text-red-300 hover:bg-red-900/80 transition-colors"
                >
                  Void
                </button>
                <button
                  onClick={() => handleRefund(row.id)}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/40 text-rose-300 hover:bg-rose-900/80 transition-colors"
                >
                  Refund
                </button>
              </div>
            ) : (
              "—"
            )}
          </td>
        </tr>
      )}
    />
  );
}
