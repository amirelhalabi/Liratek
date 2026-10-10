/**
 * LIRA-296 P2 (FR-021) — the defective-items holding (admin): faulty units
 * taken back under a warranty claim. Not sellable until resolved: Write off
 * (the cost stands) or Not faulty (back in stock at its cost).
 * P3 (US7): Send to supplier — the supplier on record (the batch the unit
 * came from) by default; the admin picks one when none is on record.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import type {
  CreateSupplierReturnInput,
  DefectiveItemView,
} from "@liratek/core";

interface SupplierOption {
  id: number;
  name: string;
}

const STATUS_LABEL: Record<string, string> = {
  HELD: "Held",
  SENT_TO_SUPPLIER: "Sent to supplier",
  WRITTEN_OFF: "Written off",
  RETURNED_TO_STOCK: "Back in stock",
};

export function DefectiveItems() {
  const api = useApi();
  // Rule 25: `api` read through a ref; refreshed in an effect (declared
  // before the load effect, so it runs first).
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const [items, setItems] = useState<DefectiveItemView[]>([]);
  const [error, setError] = useState<string | null>(null);
  // P3 — the "Send to supplier" form for one held item.
  const [sending, setSending] = useState<DefectiveItemView | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [sendNotes, setSendNotes] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await apiRef.current.listDefectiveItems({}));
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load defective items",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openSend = async (item: DefectiveItemView) => {
    setSending(item);
    setSupplierId("");
    setSendNotes("");
    setSendError(null);
    try {
      const list = (await apiRef.current.getSuppliers()) as SupplierOption[];
      setSuppliers(Array.isArray(list) ? list : []);
    } catch {
      setSuppliers([]);
    }
  };

  const send = async () => {
    if (!sending) return;
    const payload: CreateSupplierReturnInput = {
      defective_item_id: sending.id,
      ...(supplierId ? { supplier_id: Number(supplierId) } : {}),
      ...(sendNotes.trim() ? { notes: sendNotes.trim() } : {}),
    };
    const res = await apiRef.current.createSupplierReturn(payload);
    if (!res.success) {
      setSendError(res.error);
      return;
    }
    setSending(null);
    await load();
  };

  const resolve = async (
    item: DefectiveItemView,
    outcome: "WRITE_OFF" | "NOT_FAULTY",
  ) => {
    const question =
      outcome === "WRITE_OFF"
        ? `Write off ${item.product_name ?? "this item"}? It stays out of stock.`
        : `Put ${item.product_name ?? "this item"} back in stock as not faulty?`;
    if (!window.confirm(question)) return;
    const res = await apiRef.current.resolveDefectiveItem({
      defective_item_id: item.id,
      outcome,
    });
    if (!res.success) setError(res.error);
    else await load();
  };

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="text-sm text-red-300">
          {error}
        </div>
      )}
      <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-x-auto">
        <table className="w-full min-w-[40rem]">
          <thead className="bg-slate-900">
            <tr>
              {["Item", "Serial", "Cost", "Claim", "Status", ""].map((h) => (
                <th
                  key={h}
                  className="text-left text-xs text-slate-400 px-4 py-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {items.map((d) => (
              <tr key={d.id} data-testid="defective-row">
                <td className="px-4 py-3 text-sm text-white">
                  {d.product_name}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {d.serial ?? "—"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  ${(d.unit_cost_usd * d.quantity).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  #{d.warranty_claim_id}{" "}
                  {d.claim_action ? `(${d.claim_action.toLowerCase()})` : ""}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {STATUS_LABEL[d.status] ?? d.status}
                </td>
                <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                  {d.status === "HELD" && (
                    <>
                      <button
                        onClick={() => void resolve(d, "WRITE_OFF")}
                        className="text-red-300 hover:text-red-200 mr-3"
                      >
                        Write off
                      </button>
                      <button
                        onClick={() => void resolve(d, "NOT_FAULTY")}
                        className="text-emerald-300 hover:text-emerald-200 mr-3"
                      >
                        Not faulty
                      </button>
                      <button
                        onClick={() => void openSend(d)}
                        className="text-violet-300 hover:text-violet-200"
                      >
                        Send to supplier
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !error && (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">
            No defective items.
          </p>
        )}
      </div>
      {sending && (
        <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-900/60 rounded-lg">
          <p className="text-sm text-white w-full">
            Send {sending.product_name ?? "this item"} back to the supplier
          </p>
          <label className="text-xs text-slate-400 flex flex-col">
            Supplier
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
            >
              <option value="">The supplier it came from</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400 flex flex-col flex-1 min-w-[10rem]">
            Note
            <input
              value={sendNotes}
              maxLength={500}
              onChange={(e) => setSendNotes(e.target.value)}
              className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
            />
          </label>
          <button
            onClick={() => void send()}
            className="px-3 py-1.5 rounded-lg text-sm bg-violet-600 text-white"
          >
            Send
          </button>
          <button
            onClick={() => setSending(null)}
            className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          {sendError && (
            <p role="alert" className="text-sm text-red-300 w-full">
              {sendError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
