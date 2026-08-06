import { useState, useEffect, useCallback } from "react";
import { useApi } from "@liratek/ui";
import type { CarrierLineEntity } from "@liratek/ui";
import { daysRemaining } from "@/shared/utils/daysRemaining";

interface CarrierLinesPanelProps {
  carrier: "alfa" | "mtc";
}

const CARRIER_LABEL: Record<"alfa" | "mtc", string> = {
  mtc: "MTC",
  alfa: "Alfa",
};

function addDaysToToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

  // ── Add-a-line (only ever shown while this carrier has zero active lines
  // — §0.5's UI convention of one slot per carrier) ──────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createPhone, setCreatePhone] = useState("");
  const [createLabel, setCreateLabel] = useState("");
  const [createCredits, setCreateCredits] = useState("0");
  const [createExpiryMode, setCreateExpiryMode] = useState<"date" | "days">(
    "days",
  );
  const [createDateInput, setCreateDateInput] = useState("");
  const [createDaysInput, setCreateDaysInput] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

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

  const openCreateForm = () => {
    setCreatePhone("");
    setCreateLabel("");
    setCreateCredits("0");
    setCreateExpiryMode("days");
    setCreateDateInput("");
    setCreateDaysInput("");
    setCreateError("");
    setShowCreateForm(true);
  };

  const closeCreateForm = () => setShowCreateForm(false);

  const handleCreate = async () => {
    setCreateError("");
    if (!createPhone.trim()) {
      setCreateError("Phone number is required");
      return;
    }
    const resolvedDate =
      createExpiryMode === "days" && createDaysInput.trim() !== ""
        ? addDaysToToday(Number(createDaysInput))
        : createExpiryMode === "date" && createDateInput.trim() !== ""
          ? createDateInput
          : null;

    setCreating(true);
    try {
      // Same createCarrierLine path Settings' CarrierLinesManager uses —
      // via useApi() (rule 19a), never raw window.api. NOTE (§0.1/§0.5 gap):
      // this create path does not yet set the provider drawer to
      // getCarrierCreditsSum(carrier) — see this phase's report for detail;
      // not fixed here to avoid a second, divergent write.
      const res = await api.createCarrierLine({
        carrier,
        phone_number: createPhone.trim(),
        label: createLabel.trim() || null,
        credits: Number(createCredits) || 0,
        validity_expires_at: resolvedDate,
      });
      if (res.success) {
        setShowCreateForm(false);
        await load();
      } else {
        setCreateError(res.error || "Failed to add line");
      }
    } finally {
      setCreating(false);
    }
  };

  if (lines.length === 0) {
    if (!showCreateForm) {
      return (
        <div className="mb-3" data-testid="carrier-lines-panel-empty">
          <button
            type="button"
            onClick={openCreateForm}
            data-testid={`add-carrier-line-${carrier}`}
            className="rounded-lg border border-dashed border-slate-600 bg-slate-800/40 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors"
          >
            + Add {CARRIER_LABEL[carrier]} line
          </button>
        </div>
      );
    }

    return (
      <div className="mb-3" data-testid="carrier-lines-panel-empty">
        <div
          className="flex flex-col gap-1.5 min-w-[220px] max-w-xs rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs"
          data-testid={`add-carrier-line-form-${carrier}`}
        >
          {createError && (
            <span className="text-red-400" data-testid="add-carrier-line-error">
              {createError}
            </span>
          )}
          <div className="flex items-center gap-1">
            <span className="text-slate-400 w-14 shrink-0">Phone</span>
            <input
              type="text"
              value={createPhone}
              onChange={(e) => setCreatePhone(e.target.value)}
              placeholder="03123456"
              className="flex-1 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-400 w-14 shrink-0">Label</span>
            <input
              type="text"
              value={createLabel}
              onChange={(e) => setCreateLabel(e.target.value)}
              placeholder="optional"
              className="flex-1 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-400 w-14 shrink-0">Credits</span>
            <input
              type="number"
              step="0.01"
              value={createCredits}
              onChange={(e) => setCreateCredits(e.target.value)}
              className="w-20 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setCreateExpiryMode(
                  createExpiryMode === "days" ? "date" : "days",
                )
              }
              className="text-slate-400 underline shrink-0"
            >
              {createExpiryMode === "days" ? "days from today" : "pick date"}
            </button>
            {createExpiryMode === "days" ? (
              <input
                type="number"
                min="0"
                value={createDaysInput}
                onChange={(e) => setCreateDaysInput(e.target.value)}
                placeholder="30"
                className="w-14 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
              />
            ) : (
              <input
                type="date"
                value={createDateInput}
                onChange={(e) => setCreateDateInput(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
              />
            )}
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              disabled={creating}
              onClick={handleCreate}
              className="px-2 py-0.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded"
            >
              {creating ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={closeCreateForm}
              disabled={creating}
              className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

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
