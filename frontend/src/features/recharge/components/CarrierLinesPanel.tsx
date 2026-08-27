import { useState, useEffect, useCallback } from "react";
import { useApi } from "@liratek/ui";
import type { CarrierLineEntity } from "@liratek/ui";
import { daysRemaining } from "@/shared/utils/daysRemaining";
import logger from "@/utils/logger";

interface CarrierLinesPanelProps {
  carrier: "alfa" | "mtc";
}

const CARRIER_LABEL: Record<"alfa" | "mtc", string> = {
  mtc: "MTC",
  alfa: "Alfa",
};

/** Cents precision for the two linked credit fields, so deriving one from the
 *  other can't leave a 0.30000000000000004 in the box. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addDaysToToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Compact panel: each active line's credits + days-remaining, with two
 * per-line actions.
 *
 * - Quick-update (click the chip): overwrites the stored credits and/or the
 *   expiry ("days from today" or a date, both persisted as a resolved date).
 *   Informational only — no drawer legs, no checkout/closing involvement.
 * - "Record usage" (LIRA-145): books the credits the shop consumed as a
 *   `Line_Usage` expense at face value ($1/credit, USD). This one DOES move
 *   money — the server writes the expense + unified EXPENSE transaction +
 *   one payment leg on the carrier's credit drawer + the linked movement
 *   that decrements the line, all in one db transaction. Reversible through
 *   the generic void path in the Transactions viewer. */
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

  // ── Record usage (LIRA-145) ────────────────────────────────────────────
  // Booking consumed credits as a `Line_Usage` expense. Unlike the quick
  // update above (which just overwrites the stored figure), this one moves
  // money: the server writes the expense, the unified EXPENSE transaction,
  // one payment leg on the carrier's credit drawer, and the linked movement
  // that decrements the line — all in one db transaction.
  const [usageLineId, setUsageLineId] = useState<number | null>(null);
  const [usageNewBalance, setUsageNewBalance] = useState("");
  const [usageUsed, setUsageUsed] = useState("");
  const [usageNote, setUsageNote] = useState("");
  const [usageError, setUsageError] = useState("");
  const [usageSaving, setUsageSaving] = useState(false);
  const [usageFeedback, setUsageFeedback] = useState("");

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
    setUsageLineId(null);
    setUsageFeedback("");
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

  const openUsage = (line: CarrierLineEntity) => {
    setEditingId(null);
    setUsageLineId(line.id);
    setUsageNewBalance("");
    setUsageUsed("");
    setUsageNote("");
    setUsageError("");
    setUsageFeedback("");
  };

  const closeUsage = () => {
    setUsageLineId(null);
    setUsageError("");
  };

  // The two amount boxes are one value seen from both ends: typing a new
  // balance derives "credits used" and vice versa. Derived in the change
  // handlers rather than an effect so neither can echo back into the other.
  const onUsageNewBalanceChange = (raw: string, current: number) => {
    setUsageNewBalance(raw);
    setUsageError("");
    const parsed = raw.trim() === "" ? NaN : Number(raw);
    setUsageUsed(
      Number.isFinite(parsed) ? String(round2(current - parsed)) : "",
    );
  };

  const onUsageUsedChange = (raw: string, current: number) => {
    setUsageUsed(raw);
    setUsageError("");
    const parsed = raw.trim() === "" ? NaN : Number(raw);
    setUsageNewBalance(
      Number.isFinite(parsed) ? String(round2(current - parsed)) : "",
    );
  };

  const handleRecordUsage = async (line: CarrierLineEntity) => {
    const current = line.credits ?? 0;
    const newCredits =
      usageNewBalance.trim() === "" ? NaN : Number(usageNewBalance);
    if (
      !Number.isFinite(newCredits) ||
      newCredits < 0 ||
      newCredits >= current
    ) {
      setUsageError(
        `New balance must be between $0 and $${round2(current)} (below the current balance)`,
      );
      return;
    }

    setUsageSaving(true);
    setUsageError("");
    try {
      const note = usageNote.trim();
      const res = await api.recordCarrierLineUsage({
        carrierLineId: line.id,
        newCredits,
        // Optimistic-concurrency guard: the balance this form was rendered
        // against. The server rejects if a parallel session moved the line.
        expectedCurrentCredits: current,
        // Omitted, never `undefined` — the workspace runs
        // exactOptionalPropertyTypes, and an empty note is no note.
        ...(note ? { note } : {}),
      });
      if (res.success) {
        const booked = res.data?.creditsUsed ?? round2(current - newCredits);
        closeUsage();
        setUsageFeedback(
          `Recorded a $${booked.toFixed(2)} ${CARRIER_LABEL[carrier]} line-usage expense`,
        );
        await load();
      } else {
        const message = res.error || "Failed to record usage";
        // The server's stale-balance rejection: someone moved this line while
        // the form was open. Say so plainly and pull the real figure back in
        // — re-submitting the stale number would book the wrong amount.
        if (/balance changed/i.test(message)) {
          setUsageError(
            "This line's balance changed since you opened the form — refreshed; re-enter the new balance.",
          );
          setUsageNewBalance("");
          setUsageUsed("");
          await load();
        } else {
          setUsageError(message);
        }
      }
    } catch (err) {
      // A transport-level THROW, not a server `{ success: false }`. Reachable
      // on both transports: in the browser requestJson() throws on every
      // non-2xx (expired JWT → 401, role denial → 403, the route's own 500),
      // and on the desktop an IPC channel that isn't registered throws, then
      // ipcOrHttp falls back to http() with no backend to reach. Without this
      // clause a money write fails in complete silence — no error, no success,
      // the form just returns to idle and the rejection escapes unhandled.
      logger.error("Failed to record carrier line usage:", err);
      const detail = err instanceof Error ? err.message.trim() : "";
      setUsageError(
        detail
          ? `Failed to record usage: ${detail}`
          : "Failed to record usage — check your connection and try again",
      );
      // Deliberately NOT reloading here: the typed figures and the rendered
      // `expectedCurrentCredits` stay as they were, so if the write actually
      // committed before the response was lost, a re-click still carries the
      // stale expected balance and the server's concurrency guard rejects it.
      // Refreshing would erase that double-submit protection.
    } finally {
      setUsageSaving(false);
    }
  };

  return (
    <div className="mb-3" data-testid="carrier-lines-panel">
      {usageFeedback && (
        <div
          className="mb-1.5 text-xs text-emerald-400"
          data-testid="carrier-line-usage-success"
        >
          {usageFeedback}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {lines.map((line) => {
          const remaining =
            line.validity_expires_at != null
              ? daysRemaining(line.validity_expires_at)
              : null;
          const isEditing = editingId === line.id;
          const isRecordingUsage = usageLineId === line.id;
          const currentCredits = line.credits ?? 0;
          const parsedNewBalance =
            usageNewBalance.trim() === "" ? NaN : Number(usageNewBalance);
          const usageDelta = round2(currentCredits - parsedNewBalance);
          // Submit gate — mirrors the server's own rejection (below the
          // current balance, never negative). The server additionally
          // enforces a $0.01 minimum delta and reports it if it bites.
          const usageValid =
            Number.isFinite(parsedNewBalance) &&
            parsedNewBalance >= 0 &&
            parsedNewBalance < currentCredits;

          return (
            <div
              key={line.id}
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs"
            >
              {isRecordingUsage ? (
                <div
                  className="flex flex-col gap-1.5 min-w-[240px] max-w-xs"
                  data-testid={`carrier-line-usage-form-${line.id}`}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 w-24 shrink-0">
                      Current
                    </span>
                    <span className="text-emerald-400 font-mono">
                      ${currentCredits.toLocaleString()}
                    </span>
                    <span className="text-slate-500 truncate">
                      {line.label || line.phone_number}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 w-24 shrink-0">
                      New balance
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={usageNewBalance}
                      onChange={(e) =>
                        onUsageNewBalanceChange(e.target.value, currentCredits)
                      }
                      data-testid="carrier-line-usage-new-balance"
                      className="w-20 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 w-24 shrink-0">
                      Credits used
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={usageUsed}
                      onChange={(e) =>
                        onUsageUsedChange(e.target.value, currentCredits)
                      }
                      data-testid="carrier-line-usage-used"
                      className="w-20 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 w-24 shrink-0">Note</span>
                    <input
                      type="text"
                      value={usageNote}
                      onChange={(e) => setUsageNote(e.target.value)}
                      maxLength={500}
                      placeholder="optional"
                      data-testid="carrier-line-usage-note"
                      className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
                    />
                  </div>
                  <span
                    data-testid="carrier-line-usage-preview"
                    className={usageValid ? "text-amber-400" : "text-slate-500"}
                  >
                    {usageValid
                      ? `Records a $${usageDelta.toFixed(2)} expense`
                      : `Enter a new balance below $${round2(currentCredits)}`}
                  </span>
                  {usageError && (
                    <span
                      className="text-red-400"
                      data-testid="carrier-line-usage-error"
                    >
                      {usageError}
                    </span>
                  )}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={!usageValid || usageSaving}
                      onClick={() => handleRecordUsage(line)}
                      data-testid="carrier-line-usage-submit"
                      className="px-2 py-0.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                    >
                      {usageSaving ? "Recording…" : "Record"}
                    </button>
                    <button
                      type="button"
                      onClick={closeUsage}
                      disabled={usageSaving}
                      className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : !isEditing ? (
                <div className="flex items-center gap-2">
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
                  <button
                    type="button"
                    onClick={() => openUsage(line)}
                    data-testid={`carrier-line-usage-open-${line.id}`}
                    title={`Book credits used from this ${CARRIER_LABEL[carrier]} line as an expense`}
                    className="shrink-0 rounded border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-slate-500 hover:bg-slate-700/60 hover:text-white transition-colors"
                  >
                    Record usage
                  </button>
                </div>
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
    </div>
  );
}
