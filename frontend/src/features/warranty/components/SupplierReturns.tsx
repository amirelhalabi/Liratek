/**
 * LIRA-296 P3 (US7) — supplier returns (admin): defective items sent back to
 * their supplier, and the supplier's answer. An open (Sent) return is closed
 * as Credited (the supplier's balance goes down by the credit), Replaced
 * (one unit back in stock at its cost) or Rejected (nothing moves; the item
 * comes back to the defective holding — a note says why).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import type {
  CloseSupplierReturnInput,
  SupplierReturnOutcome,
  SupplierReturnView,
} from "@liratek/core";

const STATUS_LABEL: Record<string, string> = {
  SENT: "Sent",
  CREDITED: "Credited",
  REPLACED: "Replaced",
  REJECTED: "Rejected",
};

const OUTCOMES: { value: SupplierReturnOutcome; label: string }[] = [
  { value: "CREDITED", label: "Credited" },
  { value: "REPLACED", label: "Replaced" },
  { value: "REJECTED", label: "Rejected" },
];

function money(r: SupplierReturnView): string {
  const parts: string[] = [];
  if (r.credit_usd) parts.push(`$${r.credit_usd.toFixed(2)}`);
  if (r.credit_lbp) parts.push(`${r.credit_lbp.toLocaleString()} LBP`);
  return parts.join(" + ") || "—";
}

function CloseForm({
  ret,
  onDone,
  onCancel,
}: {
  ret: SupplierReturnView;
  onDone: (error: string | null) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const [outcome, setOutcome] = useState<SupplierReturnOutcome | null>(null);
  const [creditUsd, setCreditUsd] = useState("");
  const [creditLbp, setCreditLbp] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const usd = Number(creditUsd) || 0;
  const lbp = Number(creditLbp) || 0;
  const ready =
    outcome !== null &&
    (outcome !== "CREDITED" || usd > 0 || lbp > 0) &&
    (outcome !== "REJECTED" || notes.trim() !== "");

  const save = async () => {
    if (!outcome) return;
    const payload: CloseSupplierReturnInput = {
      supplier_return_id: ret.id,
      outcome,
      ...(outcome === "CREDITED" && usd > 0 ? { credit_usd: usd } : {}),
      ...(outcome === "CREDITED" && lbp > 0 ? { credit_lbp: lbp } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    setBusy(true);
    const res = await apiRef.current.closeSupplierReturn(payload);
    setBusy(false);
    onDone(res.success ? null : res.error);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-900/60 rounded-lg">
      <fieldset className="flex gap-3">
        <legend className="sr-only">Supplier's answer</legend>
        {OUTCOMES.map((o) => (
          <label key={o.value} className="flex items-center gap-1 text-sm">
            <input
              type="radio"
              name={`outcome-${ret.id}`}
              checked={outcome === o.value}
              onChange={() => setOutcome(o.value)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      {outcome === "CREDITED" && (
        <>
          <label className="text-xs text-slate-400 flex flex-col">
            Credit (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              value={creditUsd}
              onChange={(e) => setCreditUsd(e.target.value)}
              className="mt-1 w-28 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-400 flex flex-col">
            Credit (LBP)
            <input
              type="number"
              min="0"
              step="1000"
              value={creditLbp}
              onChange={(e) => setCreditLbp(e.target.value)}
              className="mt-1 w-32 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
            />
          </label>
        </>
      )}
      <label className="text-xs text-slate-400 flex flex-col flex-1 min-w-[10rem]">
        Note
        <input
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={outcome === "REJECTED" ? "Why was it rejected?" : ""}
          className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
        />
      </label>
      <button
        onClick={() => void save()}
        disabled={!ready || busy}
        className="px-3 py-1.5 rounded-lg text-sm bg-violet-600 text-white disabled:opacity-40"
      >
        Save
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white"
      >
        Cancel
      </button>
    </div>
  );
}

export function SupplierReturns() {
  const api = useApi();
  // Rule 25: `api` read through a ref; refreshed in an effect.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const [rows, setRows] = useState<SupplierReturnView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await apiRef.current.listSupplierReturns({}));
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load supplier returns",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="text-sm text-red-300">
          {error}
        </div>
      )}
      <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-x-auto">
        <table className="w-full min-w-[44rem]">
          <thead className="bg-slate-900">
            <tr>
              {["Item", "Supplier", "Cost", "Sent on", "Status", "Credit", ""].map(
                (h) => (
                  <th
                    key={h}
                    className="text-left text-xs text-slate-400 px-4 py-3"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {rows.map((r) => (
              <tr key={r.id} data-testid="supplier-return-row">
                <td className="px-4 py-3 text-sm text-white">
                  {r.product_name ?? "—"}
                  {r.serial ? (
                    <span className="block text-xs text-slate-400">
                      {r.serial}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {r.supplier_name ?? `#${r.supplier_id}`}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {r.unit_cost_usd != null
                    ? `$${r.unit_cost_usd.toFixed(2)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {r.sent_at?.slice(0, 10) ?? "—"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {STATUS_LABEL[r.status] ?? r.status}
                  {r.notes ? (
                    <span className="block text-xs text-slate-400">
                      {r.notes}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {money(r)}
                </td>
                <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                  {r.status === "SENT" && closing !== r.id && (
                    <button
                      onClick={() => setClosing(r.id)}
                      className="text-violet-300 hover:text-violet-200"
                    >
                      Record answer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">
            No supplier returns.
          </p>
        )}
      </div>
      {closing !== null &&
        rows
          .filter((r) => r.id === closing)
          .map((r) => (
            <CloseForm
              key={r.id}
              ret={r}
              onCancel={() => setClosing(null)}
              onDone={(err) => {
                if (err) {
                  setError(err);
                  return;
                }
                setClosing(null);
                void load();
              }}
            />
          ))}
    </div>
  );
}
