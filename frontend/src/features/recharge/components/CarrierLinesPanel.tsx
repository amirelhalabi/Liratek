import { useState, useEffect, useCallback } from "react";
import { useApi } from "@liratek/ui";
import type { CarrierLineEntity } from "@liratek/ui";

interface CarrierLinesPanelProps {
  carrier: "alfa" | "mtc";
}

/** Local YYYY-MM-DD for "today" — date-only, no UTC/local shift risk since
 *  we never touch a server timestamp here, only user-picked local dates. */
function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysToToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Days remaining until a stored YYYY-MM-DD date, date-only (no time-of-day
 *  component on either side, so no timezone drift). Negative = expired. */
function daysRemaining(dateStr: string): number {
  const [ty, tm, td] = todayDateString().split("-").map(Number);
  const [ey, em, ed] = dateStr.split("-").map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  const expiry = Date.UTC(ey, em - 1, ed);
  return Math.round((expiry - today) / 86_400_000);
}

/** Compact panel: each active line's credits + days-remaining, with an
 * inline quick-update (credits and/or a new expiry — "days from today" or a
 * date, both persisted as a resolved date). Informational only — no drawer
 * legs, no checkout/closing involvement. */
export function CarrierLinesPanel({ carrier }: CarrierLinesPanelProps) {
  const api = useApi();
  const [lines, setLines] = useState<CarrierLineEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creditsInput, setCreditsInput] = useState("");
  const [expiryMode, setExpiryMode] = useState<"date" | "days">("days");
  const [dateInput, setDateInput] = useState("");
  const [daysInput, setDaysInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getActiveCarrierLines(carrier);
      setLines(data);
    } catch {
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [api, carrier]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return null;
  if (lines.length === 0) return null;

  const openEdit = (line: CarrierLineEntity) => {
    setEditingId(line.id);
    setCreditsInput(String(line.credits ?? 0));
    setExpiryMode("days");
    setDaysInput("");
    setDateInput(line.validity_expires_at ?? "");
  };

  const closeEdit = () => setEditingId(null);

  const handleSave = async (id: number) => {
    setSaving(true);
    try {
      const resolvedDate =
        expiryMode === "days" && daysInput.trim() !== ""
          ? addDaysToToday(Number(daysInput))
          : expiryMode === "date" && dateInput.trim() !== ""
            ? dateInput
            : undefined;
      const credits =
        creditsInput.trim() !== "" ? Number(creditsInput) : undefined;

      if (credits === undefined && resolvedDate === undefined) {
        closeEdit();
        return;
      }

      const res = await api.updateCarrierLineBalance(id, {
        ...(credits !== undefined ? { credits } : {}),
        ...(resolvedDate !== undefined
          ? { validity_expires_at: resolvedDate }
          : {}),
      });
      if (res.success) {
        closeEdit();
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mb-3 flex flex-wrap gap-2"
      data-testid="carrier-lines-panel"
    >
      {lines.map((line) => {
        const remaining =
          line.validity_expires_at != null
            ? daysRemaining(line.validity_expires_at)
            : null;
        const isEditing = editingId === line.id;

        return (
          <div
            key={line.id}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs"
          >
            {!isEditing ? (
              <button
                type="button"
                onClick={() => openEdit(line)}
                className="flex items-center gap-2 text-left"
                data-testid={`carrier-line-${line.id}`}
              >
                <span className="font-mono text-white">
                  {line.label || line.phone_number}
                </span>
                <span className="text-emerald-400 font-mono">
                  ${line.credits.toLocaleString()}
                </span>
                {remaining !== null && (
                  <span
                    className={
                      remaining < 0
                        ? "text-red-400 font-mono"
                        : remaining <= 3
                          ? "text-amber-400 font-mono"
                          : "text-slate-400 font-mono"
                    }
                  >
                    {remaining < 0
                      ? `expired ${Math.abs(remaining)}d ago`
                      : `${remaining}d left`}
                  </span>
                )}
              </button>
            ) : (
              <div className="flex flex-col gap-1.5 min-w-[180px]">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Credits</span>
                  <input
                    type="number"
                    step="0.01"
                    value={creditsInput}
                    onChange={(e) => setCreditsInput(e.target.value)}
                    className="w-16 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setExpiryMode(expiryMode === "days" ? "date" : "days")
                    }
                    className="text-slate-400 underline"
                  >
                    {expiryMode === "days" ? "days from today" : "pick date"}
                  </button>
                  {expiryMode === "days" ? (
                    <input
                      type="number"
                      min="0"
                      value={daysInput}
                      onChange={(e) => setDaysInput(e.target.value)}
                      placeholder="30"
                      className="w-14 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
                    />
                  ) : (
                    <input
                      type="date"
                      value={dateInput}
                      onChange={(e) => setDateInput(e.target.value)}
                      className="bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSave(line.id)}
                    className="px-2 py-0.5 bg-orange-600 hover:bg-orange-500 text-white rounded"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={closeEdit}
                    className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
