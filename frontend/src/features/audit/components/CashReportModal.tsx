import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Banknote } from "lucide-react";
import { DataTable } from "@liratek/ui";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import { localDay, localMonth } from "@/shared/utils/localDay";

/**
 * D1 — Cash Report: customer cash in/out per business date, split by currency.
 * Aggregates the same customer-facing payment legs that drive the transactions
 * table's in/out column (internal/system legs excluded). Export comes free via
 * the DataTable's built-in Excel/PDF export.
 */

type ApiRow = {
  date: string;
  currency_code: string;
  total_in: number;
  total_out: number;
};

type ReportRow = {
  date: string;
  usd_in: number;
  usd_out: number;
  lbp_in: number;
  lbp_out: number;
};

/** Pivot per-currency rows into one row per date. */
function pivotByDate(rows: ApiRow[]): ReportRow[] {
  const byDate = new Map<string, ReportRow>();
  for (const r of rows) {
    const row = byDate.get(r.date) ?? {
      date: r.date,
      usd_in: 0,
      usd_out: 0,
      lbp_in: 0,
      lbp_out: 0,
    };
    if (r.currency_code === "USD") {
      row.usd_in += r.total_in;
      row.usd_out += r.total_out;
    } else if (r.currency_code === "LBP") {
      row.lbp_in += r.total_in;
      row.lbp_out += r.total_out;
    }
    byDate.set(r.date, row);
  }
  // Newest date first (matches the backend ordering).
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

function today(): string {
  return localDay();
}

function monthStart(): string {
  return `${localMonth()}-01`;
}

const usd = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lbp = (v: number) => `${Math.round(v).toLocaleString()} LBP`;

export default function CashReportModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const data = await window.api.transactions.getCashFlowByDate(from, to);
      setRows(pivotByDate(data || []));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          usd_in: t.usd_in + r.usd_in,
          usd_out: t.usd_out + r.usd_out,
          lbp_in: t.lbp_in + r.lbp_in,
          lbp_out: t.lbp_out + r.lbp_out,
        }),
        { usd_in: 0, usd_out: 0, lbp_in: 0, lbp_out: 0 },
      ),
    [rows],
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        data-testid="cash-report-modal"
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white">
              Cash Report — In / Out by Date
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800">
          <DateRangeFilter
            from={from}
            to={to}
            onFromChange={setFrom}
            onToChange={setTo}
          />
          <span className="text-xs text-slate-500">
            Customer cash only — internal &amp; system movements excluded
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-center text-slate-400 py-10 text-sm">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-500 py-10 text-sm">
              No cash movements in this range.
            </div>
          ) : (
            <DataTable<ReportRow>
              columns={["Date", "USD In", "USD Out", "LBP In", "LBP Out"]}
              data={rows}
              renderRow={(r) => (
                <tr
                  key={r.date}
                  data-testid={`cash-report-row-${r.date}`}
                  className="border-t border-slate-800 text-sm hover:bg-slate-800/40"
                >
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {r.date}
                  </td>
                  <td className="px-3 py-2 font-mono text-emerald-400">
                    {r.usd_in ? usd(r.usd_in) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-red-400">
                    {r.usd_out ? usd(r.usd_out) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-emerald-400">
                    {r.lbp_in ? lbp(r.lbp_in) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-red-400">
                    {r.lbp_out ? lbp(r.lbp_out) : "—"}
                  </td>
                </tr>
              )}
            />
          )}
        </div>

        <div
          data-testid="cash-report-totals"
          className="flex items-center justify-end gap-6 px-5 py-3 border-t border-slate-700 text-sm font-mono"
        >
          <span className="text-slate-400 font-sans text-xs uppercase tracking-wider">
            Totals
          </span>
          <span className="text-emerald-400">In {usd(totals.usd_in)}</span>
          <span className="text-red-400">Out {usd(totals.usd_out)}</span>
          <span className="text-emerald-400">In {lbp(totals.lbp_in)}</span>
          <span className="text-red-400">Out {lbp(totals.lbp_out)}</span>
        </div>
      </div>
    </div>
  );
}
