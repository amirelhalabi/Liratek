import { useState, useEffect, useCallback, useRef } from "react";
import { Check, ChevronDown, Phone, X } from "lucide-react";
import { useApi, appEvents } from "@liratek/ui";
import type {
  CarrierLineEntity,
  CarrierLineOwedDeliveryEntity,
} from "@liratek/ui";
import { daysRemaining } from "@/shared/utils/daysRemaining";
// LIRA-157 — "expired" and "burned" are different facts: a line lapsed inside
// the revival grace can still be charged, one past it cannot. `isLineBurned`
// classifies with the SAME rule the write path enforces (classifyLineValidity).
// The chip and the modal share these predicates (rule 14).
import {
  pickMainLine,
  lineValidityTone,
  isLineBurned,
  sumLineCredits,
  isDrawerMismatch,
  carrierLinesNeedAttention,
  lineBalanceClass,
} from "../utils/carrierLinesSummary";
import logger from "@/utils/logger";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";

// m6 fix (2026-09-24 adversarial review): a stable module-level empty array,
// never a fresh `[]` literal per render/catch — an unstable identity here
// would be handed straight into state and re-render every consumer that
// depends on referential equality (rule 25's own hazard, one layer up from
// the `api` dependency issue this file already documents).
const EMPTY_DELIVERIES: CarrierLineOwedDeliveryEntity[] = [];

interface CarrierLinesPanelProps {
  carrier: "alfa" | "mtc";
  /** The carrier drawer's USD balance (LIRA-252 E). When it no longer equals
   *  the sum of the active lines' credits (RechargeRepository §0.1), the panel
   *  warns so the shop fixes it with a checkpoint. Undefined = unknown, no
   *  warning. */
  drawerUsd?: number | undefined;
  /** LIRA-328 — the line sales send credits from (the page owns it so the
   *  sale can carry it). null/undefined = the primary line. */
  selectedLineId?: number | null;
  onSelectedLineChange?: (id: number | null) => void;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

/** Shop lines for one carrier, as a compact chip in the Mobile Recharge top
 * row (main line number only — the stats card's wallet already shows the
 * total — "+N" more lines, a warning dot) that opens
 * a modal holding every line with its credits + days-remaining and two
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
export function CarrierLinesPanel({
  selectedLineId = null,
  onSelectedLineChange,
  carrier,
  drawerUsd,
}: CarrierLinesPanelProps) {
  const api = useApi();
  // m6 fix (rule 25): `useApi()` is only stable in production because
  // `ApiProvider` happens to hand out a module-level singleton — a test's
  // `jest.mock("@liratek/ui", () => ({ useApi: () => ({...}) }))` returns a
  // FRESH object every call, which is exactly the unstable identity that
  // would otherwise re-fire `load`/`loadDeliveries` on every render. Read
  // through a ref so the callbacks below need no `api` dependency at all.
  const apiRef = useRef(api);
  apiRef.current = api;
  const [lines, setLines] = useState<CarrierLineEntity[]>([]);
  // Only the FIRST load hides the chip. Later reloads (after Record usage, on
  // `carrier-lines:changed`) keep the chip and an open modal on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Opened from a line chip: the modal shows only that line's Record usage
  // form. "All lines" switches to the full list (edit, add, deliveries).
  const [quickUsage, setQuickUsage] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
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

  // ── "Days still to send" list (#28, LIRA-218) ──────────────────────────
  // One row per DAYS sale that sold ahead of the line's real remaining
  // days. "Mark sent" is pure checklist bookkeeping — it records that the
  // days were physically delivered, never a second sale/charge (see
  // CarrierLineOwedDeliveryRepository's module doc).
  const [pendingDeliveries, setPendingDeliveries] = useState<
    CarrierLineOwedDeliveryEntity[]
  >([]);
  const [markingSentId, setMarkingSentId] = useState<number | null>(null);
  const [markSentError, setMarkSentError] = useState("");

  // m6 fix: wrapped in try/catch (the "days still to send" list is
  // secondary information — a failed fetch must not crash the whole panel,
  // matching `load`'s own established convention just below), falling back
  // to the STABLE `EMPTY_DELIVERIES` constant rather than a fresh `[]`.
  // A picked line that is no longer active falls back to the primary, and the
  // page forgets it so the next sale goes to the primary too.
  useEffect(() => {
    if (
      hasLoaded &&
      selectedLineId != null &&
      !lines.some((l) => l.id === selectedLineId)
    ) {
      onSelectedLineChange?.(null);
    }
  }, [hasLoaded, lines, selectedLineId, onSelectedLineChange]);

  // Close the line picker on an outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  const loadDeliveries = useCallback(async () => {
    try {
      const res = await apiRef.current.getPendingCarrierLineOwedDeliveries();
      setPendingDeliveries(
        res.success ? (res.data ?? EMPTY_DELIVERIES) : EMPTY_DELIVERIES,
      );
    } catch {
      setPendingDeliveries(EMPTY_DELIVERIES);
    }
  }, []);

  const handleMarkSent = async (deliveryId: number) => {
    setMarkingSentId(deliveryId);
    setMarkSentError("");
    try {
      const res =
        await apiRef.current.markCarrierLineOwedDeliverySent(deliveryId);
      if (res.success) {
        await loadDeliveries();
      } else {
        // m6 fix: a failed "Mark sent" used to fail silently — no
        // notification, nothing telling the operator to retry.
        setMarkSentError(res.error || "Failed to mark as sent");
      }
    } catch {
      setMarkSentError("Failed to mark as sent");
    } finally {
      setMarkingSentId(null);
    }
  };

  const load = useCallback(async () => {
    try {
      const data = await apiRef.current.getActiveCarrierLines(carrier);
      setLines(data);
    } catch {
      setLines([]);
    } finally {
      setHasLoaded(true);
    }
  }, [carrier]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);

  // m1 fix (2026-09-24 adversarial review): this panel previously only
  // refetched on MOUNT — a DAYS sale (or self-charge) elsewhere on the
  // page left both the chip (credits/validity/sold-ahead) and the "days
  // still to send" list stale until a full remount. `carrier` narrows the
  // refresh to this panel's own tab; an event with none (or matching)
  // triggers both refetches.
  useEffect(() => {
    return appEvents.on("carrier-lines:changed", (changedCarrier) => {
      if (!changedCarrier || changedCarrier === carrier) {
        load();
        loadDeliveries();
      }
    });
  }, [carrier, load, loadDeliveries]);

  // Escape closes the shop-lines modal, like a click on its backdrop.
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuickUsage(false);
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  if (!hasLoaded) return null;

  const lineIds = new Set(lines.map((l) => l.id));
  const deliveriesForThisCarrier = pendingDeliveries.filter((d) =>
    lineIds.has(d.carrier_line_id),
  );

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

  // Empty state (no active line for this carrier): the same "+ Add line"
  // action and inline form as before, now inside the modal.
  const emptyBody = !showCreateForm ? (
    <div data-testid="carrier-lines-panel-empty">
      <button
        type="button"
        onClick={openCreateForm}
        data-testid={`add-carrier-line-${carrier}`}
        className="rounded-lg border border-dashed border-slate-600 bg-slate-800/40 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors"
      >
        + Add {CARRIER_LABEL[carrier]} line
      </button>
    </div>
  ) : (
    <div data-testid="carrier-lines-panel-empty">
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
              setCreateExpiryMode(createExpiryMode === "days" ? "date" : "days")
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
    if (quickUsage) {
      setQuickUsage(false);
      setModalOpen(false);
    }
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
        const msg = `Recorded a $${booked.toFixed(2)} ${CARRIER_LABEL[carrier]} line-usage expense`;
        if (quickUsage) appEvents.emit("notification:show", msg, "success");
        closeUsage();
        setUsageFeedback(msg);
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
      // LIRA-247: `err instanceof Error` is false for a thrown ApiError (a
      // plain object, e.g. a web 403 role refusal), so it used to fall
      // through to the generic "check your connection" message below even
      // when the server had already said exactly why it refused.
      const detail = getApiErrorMessage(err, "").trim();
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

  const linesCreditsSum = sumLineCredits(lines);
  const showDrawerMismatch = isDrawerMismatch(drawerUsd, lines);

  const linesBody = (
    <div data-testid="carrier-lines-panel">
      {showDrawerMismatch && (
        <div
          className="mb-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300"
          data-testid="carrier-drawer-mismatch"
        >
          The {CARRIER_LABEL[carrier]} drawer shows {formatUsd(drawerUsd)}, but
          its SIM lines total {formatUsd(linesCreditsSum)}. Do a checkpoint that
          counts each line to bring them back in line.
        </div>
      )}
      {usageFeedback && (
        <div
          className="mb-1.5 text-xs text-emerald-400"
          data-testid="carrier-line-usage-success"
        >
          {usageFeedback}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {(quickUsage
          ? lines.filter((l) => l.id === usageLineId)
          : lines
        ).map((line) => {
          const remaining =
            line.validity_expires_at != null
              ? daysRemaining(line.validity_expires_at)
              : null;
          const isBurned = isLineBurned(line);
          const validityTone = lineValidityTone(line);
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
              className={
                quickUsage
                  ? ""
                  : "rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs"
              }
            >
              {isRecordingUsage ? (
                <div
                  className="flex flex-col gap-3 py-2 text-sm"
                  data-testid={`carrier-line-usage-form-${line.id}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-400">Current balance</span>
                    <span
                      className={`${lineBalanceClass(line.credits)} font-mono text-xl font-semibold`}
                    >
                      ${currentCredits.toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">
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
                      autoFocus
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-violet-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">
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
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-violet-500"
                    />
                  </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">Note</span>
                    <input
                      type="text"
                      value={usageNote}
                      onChange={(e) => setUsageNote(e.target.value)}
                      maxLength={500}
                      placeholder="optional"
                      data-testid="carrier-line-usage-note"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-violet-500"
                    />
                  </label>
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
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={closeUsage}
                      disabled={usageSaving}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!usageValid || usageSaving}
                      onClick={() => handleRecordUsage(line)}
                      data-testid="carrier-line-usage-submit"
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium"
                    >
                      {usageSaving ? "Recording…" : "Record usage"}
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
                    {line.is_primary === 1 && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium normal-case bg-amber-500/20 text-amber-400"
                        data-testid={`carrier-line-primary-${line.id}`}
                      >
                        Primary
                      </span>
                    )}
                    <span
                      className={`${lineBalanceClass(line.credits)} font-mono`}
                    >
                      ${line.credits.toLocaleString()}
                    </span>
                    {remaining !== null && (
                      <span
                        className={
                          validityTone === "expired"
                            ? "text-red-400 font-mono"
                            : validityTone === "expiring"
                              ? "text-amber-400 font-mono"
                              : "text-slate-400 font-mono"
                        }
                      >
                        {remaining < 0
                          ? `expired ${Math.abs(remaining)}d ago`
                          : `${remaining}d left`}
                      </span>
                    )}
                    {/* #28 (LIRA-218) — a sold-ahead balance is shown
                        separately, never folded into "expired"/"burned":
                        the line is never dead because of days sold ahead. */}
                    {(line.days_owed ?? 0) > 0 && (
                      <span
                        className="text-amber-400 font-mono"
                        title="Days promised to customers ahead of the line's own remaining days. Paid off automatically by the next recharge."
                        data-testid={`carrier-line-sold-ahead-${line.id}`}
                      >
                        {line.days_owed} sold ahead
                      </span>
                    )}
                    {isBurned && (
                      <span
                        className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300"
                        title="Past the revival window — a charge will be refused. Register a new line."
                        data-testid={`carrier-line-burned-${line.id}`}
                      >
                        burned
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
      {/* #28 (LIRA-218) — "days still to send": the sale was already
          recorded once (the DAYS transaction); Mark Sent only records
          delivery, never a second sale or a second charge. */}
      {deliveriesForThisCarrier.length > 0 && (
        <div
          className="mt-2 flex flex-col gap-1"
          data-testid="carrier-lines-owed-deliveries"
        >
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Days still to send
          </span>
          {markSentError && (
            <p
              className="text-xs text-red-400"
              data-testid="carrier-line-owed-delivery-mark-sent-error"
            >
              {markSentError}
            </p>
          )}
          {deliveriesForThisCarrier.map((d) => {
            const line = lines.find((l) => l.id === d.carrier_line_id);
            return (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-xs"
                data-testid={`carrier-line-owed-delivery-${d.id}`}
              >
                <span className="text-amber-300 font-mono">{d.days_owed}d</span>
                <span className="text-slate-300">
                  {d.client_name || "Walk-in"}
                </span>
                {line && (
                  <span className="text-slate-500 font-mono">
                    ({line.label || line.phone_number})
                  </span>
                )}
                <button
                  type="button"
                  disabled={markingSentId === d.id}
                  onClick={() => handleMarkSent(d.id)}
                  data-testid={`carrier-line-owed-delivery-mark-sent-${d.id}`}
                  className="ml-auto shrink-0 rounded border border-emerald-600/40 px-1.5 py-0.5 text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50"
                >
                  Mark sent
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const mainLine = pickMainLine(lines);
  const orderedLines = mainLine
    ? [mainLine, ...lines.filter((l) => l.id !== mainLine.id)]
    : lines;
  // The picked line while it is still active; otherwise the main line.
  const selectedLine =
    (selectedLineId != null
      ? lines.find((l) => l.id === selectedLineId)
      : undefined) ?? mainLine;
  const needsAttention = carrierLinesNeedAttention({
    lines,
    drawerUsd,
    owedDeliveryCount: deliveriesForThisCarrier.length,
  });
  const title = `${CARRIER_LABEL[carrier]} shop lines`;
  const usageLine = lines.find((l) => l.id === usageLineId) ?? null;
  const modalTitle =
    quickUsage && usageLine
      ? `Record usage — ${CARRIER_LABEL[carrier]} ${usageLine.label || usageLine.phone_number}`
      : title;
  const titleId = `carrier-lines-modal-title-${carrier}`;

  return (
    <>
      {/* Top-row chip — the line sales send credits from (the primary by
          default). The number opens its Record usage form; the chevron lists
          the carrier's other lines to switch to (LIRA-328). */}
      {lines.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            openCreateForm();
            setQuickUsage(false);
            setModalOpen(true);
          }}
          data-testid={`carrier-lines-chip-${carrier}`}
          aria-haspopup="dialog"
          className="h-11 rounded-lg px-4 text-sm font-medium flex items-center gap-2 border bg-slate-800/40 text-slate-400 hover:bg-slate-800/60 hover:text-white border-dashed border-slate-600 transition-all"
        >
          <Phone size={16} className="shrink-0" aria-hidden="true" />
          <span>+ Add {CARRIER_LABEL[carrier]} line</span>
        </button>
      ) : selectedLine ? (
        <div ref={pickerRef} className="relative">
          <div className="relative flex h-11 rounded-lg border border-slate-700 bg-slate-800 text-sm font-medium">
            <button
              type="button"
              onClick={() => {
                setPickerOpen(false);
                openUsage(selectedLine);
                setQuickUsage(true);
                setModalOpen(true);
              }}
              data-testid={`carrier-lines-chip-${carrier}`}
              aria-haspopup="dialog"
              title={`Record usage on ${selectedLine.label || selectedLine.phone_number}`}
              className="flex items-center gap-2 rounded-l-lg pl-4 pr-3 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
            >
              <Phone size={16} className="shrink-0" aria-hidden="true" />
              <span className="font-mono text-white">
                {selectedLine.label || selectedLine.phone_number}
              </span>
              <span
                className={`${lineBalanceClass(selectedLine.credits)} font-mono`}
                data-testid="carrier-lines-chip-credits"
              >
                ${selectedLine.credits.toLocaleString()}
              </span>
            </button>
            {(
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                data-testid={`carrier-lines-picker-${carrier}`}
                aria-haspopup="listbox"
                aria-expanded={pickerOpen}
                aria-label={`Other ${CARRIER_LABEL[carrier]} lines`}
                className="flex items-center rounded-r-lg border-l border-slate-700 px-2 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
            )}
            {needsAttention && (
              <span
                data-testid="carrier-lines-chip-warning"
                aria-label="Needs attention"
                className="pointer-events-none absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500"
              />
            )}
          </div>
          {pickerOpen && (
            <div
              role="listbox"
              aria-label={`${CARRIER_LABEL[carrier]} lines`}
              data-testid={`carrier-lines-picker-list-${carrier}`}
              className="absolute left-0 top-full z-40 mt-1 min-w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-lg"
            >
              {orderedLines.map((line) => {
                const isSelected = line.id === selectedLine.id;
                return (
                  <button
                    key={line.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-testid={`carrier-lines-picker-option-${line.id}`}
                    onClick={() => {
                      onSelectedLineChange?.(
                        line.id === mainLine?.id ? null : line.id,
                      );
                      setPickerOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      isSelected
                        ? "bg-slate-800 text-white"
                        : "text-slate-300 hover:bg-violet-500/20 hover:text-white"
                    }`}
                  >
                    <span className="w-4 shrink-0">
                      {isSelected && <Check size={14} aria-hidden="true" />}
                    </span>
                    <span className="font-mono">
                      {line.label || line.phone_number}
                    </span>
                    {line.is_primary === 1 && (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400">
                        Primary
                      </span>
                    )}
                    <span
                      className={`ml-auto pl-3 ${lineBalanceClass(line.credits)} font-mono`}
                    >
                      ${line.credits.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* Same modal shell as the page's other dialogs (HistoryModal,
          OmtAppCashoutModal) — the app has no shared Modal component. */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
          onClick={() => {
            setQuickUsage(false);
            setModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative w-full max-w-xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
              <h2
                id={titleId}
                className="text-base font-semibold text-white flex items-center gap-2"
              >
                <Phone className="text-slate-400" size={18} />
                {modalTitle}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setQuickUsage(false);
                  setModalOpen(false);
                }}
                aria-label="Close"
                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {lines.length === 0 ? emptyBody : linesBody}

            </div>
          </div>
        </div>
      )}
    </>
  );
}
