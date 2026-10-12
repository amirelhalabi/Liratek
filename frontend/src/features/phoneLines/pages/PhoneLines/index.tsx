/**
 * Phone Lines (LIRA-309) — one place for every phone number the shop owns:
 *
 * - **For sale**: lines held for resale (inventory products in a lines
 *   category, LIRA-207) with their carrier, credit, expiry and status. The
 *   owner sets those details here (or in the product form).
 * - **Shop lines**: the shop's own MTC/Alfa lines — the existing Carrier
 *   Lines manager, reused as-is (same rules as Settings → Carrier Lines).
 *
 * Status comes from core's `classifyLineStatus`: for-sale lines warn 3 days
 * before expiry, shop lines keep their 7-day warning (owner, 2026-10-11).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import {
  classifyLineStatus,
  RESALE_LINE_EXPIRY_WARNING_DAYS,
  type ResaleLineRow,
  type SaveResaleLineInput,
  type WriteOffResaleLineInput,
} from "@liratek/core";
import { localDay } from "@/shared/utils/localDay";
import { Phone } from "lucide-react";
import CarrierLinesManager from "@/features/settings/pages/Settings/CarrierLinesManager";
import { LineStatusChip } from "@/features/phoneLines/components/LineStatusChip";
import { ResaleLineRechargePanel } from "@/features/phoneLines/components/ResaleLineRechargePanel";
import logger from "@/utils/logger";

type Tab = "for-sale" | "shop";

interface EditForm {
  productId: number;
  /** "" until the owner picks one — the carrier is never guessed. */
  carrier: "" | "mtc" | "alfa";
  expiry: string;
  credits: string;
}

function money(n: number): string {
  return `$${Number(n).toFixed(2)}`;
}

export default function PhoneLines() {
  const api = useApi();
  // rule 25: read api through a ref, never put it in a dependency array.
  const apiRef = useRef(api);
  apiRef.current = api;

  const [tab, setTab] = useState<Tab>("for-sale");
  const [lines, setLines] = useState<ResaleLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSold, setShowSold] = useState(false);
  const [onlyNoExpiry, setOnlyNoExpiry] = useState(false);
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // LIRA-309 — the lost line awaiting the owner's write-off confirmation.
  const [writeOffRow, setWriteOffRow] = useState<ResaleLineRow | null>(null);
  // LIRA-309 phase 5 — the line being recharged.
  const [rechargeRow, setRechargeRow] = useState<ResaleLineRow | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (includeSold: boolean) => {
    setLoading(true);
    try {
      const rows = await apiRef.current.getResaleLines(
        includeSold ? { include_sold: true } : {},
      );
      setLines(rows);
    } catch (err) {
      logger.error("Failed to load phone lines for sale:", err);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(showSold);
  }, [load, showSold]);

  const openEdit = (row: ResaleLineRow) => {
    setError("");
    setEdit({
      productId: row.product_id,
      carrier: row.carrier ?? "",
      expiry: row.validity_expires_at ?? "",
      credits: String(row.credits ?? 0),
    });
  };

  const handleSave = async () => {
    if (!edit) return;
    setError("");
    if (edit.carrier === "") {
      setError("Choose the line's carrier (MTC or Alfa).");
      return;
    }
    const credits = Number(edit.credits);
    if (!Number.isFinite(credits) || credits < 0) {
      setError("Credit must be zero or more.");
      return;
    }
    // ONE payload, typed from the schema (rules 21, 22).
    const payload: SaveResaleLineInput = {
      product_id: edit.productId,
      carrier: edit.carrier,
      validity_expires_at: edit.expiry || null,
      credits,
    };
    setSaving(true);
    try {
      const res = await apiRef.current.saveResaleLine(payload);
      if (!res.success) {
        setError(res.error || "Could not save the line.");
        return;
      }
      setEdit(null);
      await load(showSold);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the line.");
    } finally {
      setSaving(false);
    }
  };

  const isLost = (row: ResaleLineRow) =>
    row.is_unsold === 1 &&
    classifyLineStatus(
      row.validity_expires_at,
      localDay(),
      RESALE_LINE_EXPIRY_WARNING_DAYS,
    ).status === "LOST";

  const handleWriteOff = async () => {
    if (!writeOffRow) return;
    setError("");
    const payload: WriteOffResaleLineInput = {
      product_id: writeOffRow.product_id,
      client_day: localDay(),
    };
    setSaving(true);
    try {
      const res = await apiRef.current.writeOffResaleLine(payload);
      if (!res.success) {
        setError(res.error || "Could not write off the line.");
        return;
      }
      setNotice(
        `Line ${writeOffRow.phone_number ?? ""} written off — ${money(writeOffRow.cost_price_usd)} booked as a loss.`,
      );
      setWriteOffRow(null);
      await load(showSold);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write off the line.");
    } finally {
      setSaving(false);
    }
  };

  const visible = onlyNoExpiry
    ? lines.filter((l) => !l.validity_expires_at)
    : lines;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Phone className="w-6 h-6 text-violet-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Phone Lines</h1>
          <p className="text-sm text-slate-400">
            Your shop lines and the lines you sell, with credit, expiry and
            days left.
          </p>
        </div>
      </div>

      <div role="tablist" className="flex gap-2 border-b border-slate-700">
        {(
          [
            ["for-sale", "For sale"],
            ["shop", "Shop lines"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === key
                ? "border-violet-500 text-white"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "shop" ? (
        <CarrierLinesManager />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={onlyNoExpiry}
                onChange={(e) => setOnlyNoExpiry(e.target.checked)}
              />
              Only lines with no expiry set
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showSold}
                onChange={(e) => setShowSold(e.target.checked)}
              />
              Show sold lines
            </label>
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
              {error}
            </div>
          )}
          {notice && (
            <div className="text-emerald-400 text-sm bg-emerald-900/20 px-3 py-1.5 rounded">
              {notice}
            </div>
          )}

          {rechargeRow && (
            <ResaleLineRechargePanel
              line={rechargeRow}
              onCancel={() => setRechargeRow(null)}
              onDone={() => {
                setNotice(
                  `Line ${rechargeRow.phone_number ?? ""} recharged — its cost and price went up by what it cost.`,
                );
                setRechargeRow(null);
                void load(showSold);
              }}
            />
          )}

          {writeOffRow && (
            <div className="border border-red-700/60 rounded-lg p-4 bg-red-950/30 space-y-3">
              <p className="text-sm text-slate-200">
                Line {writeOffRow.phone_number} is lost. Book{" "}
                <span className="font-semibold">{money(writeOffRow.cost_price_usd)}</span>{" "}
                as a loss and take it out of stock? You can undo this from
                Transactions.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleWriteOff}
                  disabled={saving}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-sm"
                >
                  {saving ? "Writing off..." : "Write off"}
                </button>
                <button
                  onClick={() => setWriteOffRow(null)}
                  className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}

          <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Number</th>
                  <th className="text-left px-4 py-3">Carrier</th>
                  <th className="text-left px-4 py-3">Credit</th>
                  <th className="text-left px-4 py-3">Expiry</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Cost / Price</th>
                  <th className="text-left px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {visible.map((row) => (
                  <tr
                    key={row.product_id}
                    data-testid={`resale-line-${row.product_id}`}
                    className={row.is_unsold ? "" : "opacity-60"}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-white">
                        {row.phone_number ?? "—"}
                      </div>
                      <div className="text-xs text-slate-400">{row.name}</div>
                    </td>
                    <td className="px-4 py-3 uppercase text-xs text-slate-200">
                      {row.carrier ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-emerald-400">
                      {money(row.credits)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">
                      {row.validity_expires_at ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.is_unsold ? (
                        <LineStatusChip
                          expiry={row.validity_expires_at}
                          warningDays={RESALE_LINE_EXPIRY_WARNING_DAYS}
                        />
                      ) : (
                        <span className="text-xs text-slate-400">Sold</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">
                      {money(row.cost_price_usd)} / {money(row.selling_price_usd)}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                      {row.is_unsold === 1 && row.carrier && !isLost(row) && (
                        <button
                          onClick={() => {
                            setNotice("");
                            setEdit(null);
                            setRechargeRow(row);
                          }}
                          className="px-2 py-0.5 bg-violet-900/40 hover:bg-violet-900/60 text-violet-200 rounded text-xs"
                        >
                          Recharge
                        </button>
                      )}
                      {isLost(row) && (
                        <button
                          onClick={() => {
                            setNotice("");
                            setWriteOffRow(row);
                          }}
                          className="px-2 py-0.5 bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded text-xs"
                        >
                          Write off
                        </button>
                      )}
                      {row.is_unsold === 1 && (
                        <button
                          onClick={() => openEdit(row)}
                          className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-xs"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      No lines for sale. Add them in Inventory under a category
                      named like "Phone Lines".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {edit && (
            <div className="border border-slate-600 rounded-lg p-4 bg-slate-900/50 space-y-3">
              <h2 className="text-white font-medium">Line details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="rl-carrier" className="text-xs text-slate-400 block mb-1">
                    Carrier
                  </label>
                  <select
                    id="rl-carrier"
                    value={edit.carrier}
                    onChange={(e) =>
                      setEdit({ ...edit, carrier: e.target.value as "" | "mtc" | "alfa" })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
                  >
                    <option value="">Choose…</option>
                    <option value="mtc">MTC</option>
                    <option value="alfa">Alfa</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rl-expiry" className="text-xs text-slate-400 block mb-1">
                    Expiry date
                  </label>
                  <input
                    id="rl-expiry"
                    type="date"
                    value={edit.expiry}
                    onChange={(e) => setEdit({ ...edit, expiry: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="rl-credits" className="text-xs text-slate-400 block mb-1">
                    Credit ($)
                  </label>
                  <input
                    id="rl-credits"
                    type="number"
                    step="0.01"
                    min="0"
                    value={edit.credits}
                    onChange={(e) => setEdit({ ...edit, credits: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded text-sm"
                >
                  {saving ? "Saving..." : "Save line"}
                </button>
                <button
                  onClick={() => setEdit(null)}
                  className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
