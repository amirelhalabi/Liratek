/**
 * LIRA-296 P2 (FR-021) — the defective-items holding (admin): faulty units
 * taken back under a warranty claim. Not sellable until resolved: Write off
 * (the cost stands) or Not faulty (back in stock at its cost).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import type { DefectiveItemView } from "@liratek/core";

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
                        className="text-emerald-300 hover:text-emerald-200"
                      >
                        Not faulty
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
    </div>
  );
}
