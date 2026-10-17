/**
 * LIRA-296 P2 (FR-021) — the defective-items holding (admin): faulty units
 * taken back under a warranty claim. Not sellable until resolved: Write off
 * (the cost stands) or Not faulty (back in stock at its cost).
 * P3 (US7): Send to supplier — the supplier on record (the batch the unit
 * came from) by default; the admin picks one when none is on record.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import type {
  CreateSupplierReturnInput,
  DefectiveItemView,
} from "@liratek/core";

interface SupplierOption {
  id: number;
  name: string;
}

// Status / action codes → catalog keys, translated at render.
const STATUS_KEY = {
  HELD: "defective.status.HELD",
  SENT_TO_SUPPLIER: "defective.status.SENT_TO_SUPPLIER",
  WRITTEN_OFF: "defective.status.WRITTEN_OFF",
  RETURNED_TO_STOCK: "defective.status.RETURNED_TO_STOCK",
} as const;
const ACTION_LOWER_KEY = {
  REPAIR: "defective.actionLower.REPAIR",
  REPLACE: "defective.actionLower.REPLACE",
  REFUND: "defective.actionLower.REFUND",
} as const;
const COLUMN_KEYS = [
  "defective.col.item",
  "defective.col.serial",
  "defective.col.cost",
  "defective.col.claim",
  "defective.col.status",
] as const;

export function DefectiveItems() {
  const { t } = useTranslation(["warranty", "common"]);
  const tRef = useRef(t);
  tRef.current = t;
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
        e instanceof Error ? e.message : tRef.current("defective.loadFailed"),
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
    const name = item.product_name ?? t("defective.thisItem");
    const question =
      outcome === "WRITE_OFF"
        ? t("defective.writeOffConfirm", { name })
        : t("defective.notFaultyConfirm", { name });
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
              {COLUMN_KEYS.map((k) => (
                <th
                  key={k}
                  className="text-start text-xs text-slate-400 px-4 py-3"
                >
                  {t(k)}
                </th>
              ))}
              <th className="text-start text-xs text-slate-400 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {items.map((d) => (
              <tr key={d.id} data-testid="defective-row">
                <td className="px-4 py-3 text-sm text-white">
                  {d.product_name}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  <Ltr>{d.serial ?? "—"}</Ltr>
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  <Ltr>${(d.unit_cost_usd * d.quantity).toFixed(2)}</Ltr>
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  <Ltr>#{d.warranty_claim_id}</Ltr>{" "}
                  {d.claim_action
                    ? `(${
                        d.claim_action in ACTION_LOWER_KEY
                          ? t(
                              ACTION_LOWER_KEY[
                                d.claim_action as keyof typeof ACTION_LOWER_KEY
                              ],
                            )
                          : d.claim_action.toLowerCase()
                      })`
                    : ""}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {d.status in STATUS_KEY
                    ? t(STATUS_KEY[d.status as keyof typeof STATUS_KEY])
                    : d.status}
                </td>
                <td className="px-4 py-3 text-sm text-end whitespace-nowrap">
                  {d.status === "HELD" && (
                    <>
                      <button
                        onClick={() => void resolve(d, "WRITE_OFF")}
                        className="text-red-300 hover:text-red-200 me-3"
                      >
                        {t("defective.writeOff")}
                      </button>
                      <button
                        onClick={() => void resolve(d, "NOT_FAULTY")}
                        className="text-emerald-300 hover:text-emerald-200 me-3"
                      >
                        {t("defective.notFaulty")}
                      </button>
                      <button
                        onClick={() => void openSend(d)}
                        className="text-violet-300 hover:text-violet-200"
                      >
                        {t("defective.sendToSupplier")}
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
            {t("defective.empty")}
          </p>
        )}
      </div>
      {sending && (
        <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-900/60 rounded-lg">
          <p className="text-sm text-white w-full">
            {t("defective.sendTitle", {
              name: sending.product_name ?? t("defective.thisItem"),
            })}
          </p>
          <label className="text-xs text-slate-400 flex flex-col">
            {t("defective.supplier")}
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
            >
              <option value="">{t("defective.supplierOnRecord")}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400 flex flex-col flex-1 min-w-[10rem]">
            {t("defective.note")}
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
            {t("defective.send")}
          </button>
          <button
            onClick={() => setSending(null)}
            className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white"
          >
            {t("common:actions.cancel")}
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
