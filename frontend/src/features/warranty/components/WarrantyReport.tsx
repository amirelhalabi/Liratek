/**
 * LIRA-296 P3 (US8) — the warranty report (admin):
 *   - items still under warranty today, by category (with end dates);
 *   - claims made in the chosen period: how many of each kind, what they
 *     cost the shop, what suppliers gave back, and the net — the same net
 *     as the Profits "Warranty cost" line for those days.
 * "Today" is the browser's own day (rule 27).
 */
import { useEffect, useRef, useState } from "react";
import { DataTable, useApi } from "@liratek/ui";
import type { WarrantyReport as Report, WarrantyReportItem } from "@liratek/core";
import { localDay } from "@/shared/utils/localDay";

const usd = (n: number) => `$${n.toFixed(2)}`;

type Row = WarrantyReportItem & { category: string };

export function WarrantyReport() {
  const api = useApi();
  // Rule 25: `api` read through a ref; refreshed in an effect.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const today = localDay();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiRef.current
      .getWarrantyReport({ from, to, client_day: localDay() })
      .then((r) => {
        if (!live) return;
        setReport(r);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Could not load the report");
      });
    return () => {
      live = false;
    };
  }, [from, to]);

  const rows: Row[] =
    report?.underWarranty.flatMap((g) =>
      g.items.map((i) => ({ ...i, category: g.category })),
    ) ?? [];
  const claims = report?.claims;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-slate-400 flex flex-col">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
          />
        </label>
        <label className="text-xs text-slate-400 flex flex-col">
          To
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
          />
        </label>
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-300">
          {error}
        </div>
      )}

      {claims && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs text-slate-400">Claims in the period</p>
            <p
              className="text-2xl text-white"
              data-testid="report-claims-total"
            >
              {claims.total}
            </p>
            <p className="text-xs text-slate-400" data-testid="report-by-action">
              Repair {claims.byAction.REPAIR} · Replace{" "}
              {claims.byAction.REPLACE} · Refund {claims.byAction.REFUND}
            </p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs text-slate-400">Cost to the shop</p>
            <p className="text-2xl text-red-300" data-testid="report-gross">
              {usd(claims.grossCostUsd)}
            </p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs text-slate-400">Given back by suppliers</p>
            <p
              className="text-2xl text-emerald-300"
              data-testid="report-recovered"
            >
              {usd(claims.supplierRecoveredUsd)}
            </p>
            {claims.supplierRecoveredLbp !== 0 && (
              <p className="text-xs text-slate-400">
                + {claims.supplierRecoveredLbp.toLocaleString()} LBP
              </p>
            )}
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700/50">
            <p className="text-xs text-slate-400">Net warranty cost</p>
            <p className="text-2xl text-white" data-testid="report-net">
              {usd(claims.netCostUsd)}
            </p>
            {claims.netCostLbp !== 0 && (
              <p className="text-xs text-slate-400">
                {(-claims.netCostLbp).toLocaleString()} LBP back
              </p>
            )}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white">
          Under warranty today
        </h2>
        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
          {report?.underWarranty.map((g) => (
            <span
              key={g.category}
              data-testid={`report-category-${g.category}`}
              className="px-2 py-1 rounded bg-slate-800 border border-slate-700/50"
            >
              {g.category} <strong className="text-white">{g.count}</strong>
            </span>
          ))}
        </div>
        <DataTable<Row>
          columns={[
            { header: "Category", sortKey: "category" },
            { header: "Item", sortKey: "productName" },
            "Receipt",
            "Customer",
            { header: "Qty", sortKey: "coveredQuantity" },
            { header: "Covered until", sortKey: "warrantyUntil" },
          ]}
          data={rows}
          exportExcel
          exportPdf
          exportFilename="warranty-report"
          emptyMessage="Nothing is under warranty today."
          renderRow={(r) => (
            <tr
              key={`${r.source}-${r.saleItemId ?? r.maintenanceId}`}
              className="border-b border-slate-700/50"
            >
              <td className="px-4 py-2 text-sm text-slate-300">{r.category}</td>
              <td className="px-4 py-2 text-sm text-white">{r.productName}</td>
              <td className="px-4 py-2 text-sm text-slate-300">
                {r.receiptNumber ??
                  (r.maintenanceId ? `Repair #${r.maintenanceId}` : "—")}
              </td>
              <td className="px-4 py-2 text-sm text-slate-300">
                {r.customerName ?? "—"}
                {r.customerPhone ? ` · ${r.customerPhone}` : ""}
              </td>
              <td className="px-4 py-2 text-sm text-slate-300">
                {r.coveredQuantity}
              </td>
              <td className="px-4 py-2 text-sm text-slate-300">
                {r.warrantyUntil.slice(0, 10)}
              </td>
            </tr>
          )}
        />
      </section>
    </div>
  );
}
