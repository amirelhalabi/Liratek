/**
 * LIRA-296 P2 — start a warranty claim on ONE covered unit of a sale line:
 * Repair (staff and admin), Replace or Refund (admin, as refunds today).
 *
 *   - an EXPIRED warranty needs an admin and a reason; a VOID one can't be
 *     claimed at all (FR-003);
 *   - a tracked product's Replace asks which in-stock unit is handed over;
 *   - Refund refunds the line's share through the sale's own payment method
 *     (the same default as "Refund item");
 *   - the ONE payload (rule 22) goes through `useApi()` (rule 19) with the
 *     browser's own day (rule 27); a refusal (out of stock, already
 *     claimed, …) is shown as returned.
 */
import { useEffect, useRef, useState } from "react";
import { X, ShieldCheck } from "lucide-react";
import { useApi } from "@liratek/ui";
import type {
  CreateWarrantyClaimInput,
  WarrantyClaimActionInput,
  WarrantyState,
} from "@liratek/core";
import { localDay } from "@/shared/utils/localDay";

export interface ClaimTarget {
  /** A sale line's warranty — or `maintenanceId` for a repair's own. */
  saleItemId?: number;
  maintenanceId?: number;
  productId: number | null;
  productName: string;
  state: WarrantyState;
  units: { id: number; serial: string | null }[];
}

interface ClaimModalProps {
  target: ClaimTarget;
  isAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}

const ACTIONS: {
  value: WarrantyClaimActionInput;
  label: string;
  hint: string;
}[] = [
  {
    value: "REPAIR",
    label: "Repair",
    hint: "Opens a free repair job for the customer.",
  },
  {
    value: "REPLACE",
    label: "Replace",
    hint: "Gives the customer the same item from stock.",
  },
  {
    value: "REFUND",
    label: "Refund",
    hint: "Refunds this item; the faulty one is kept aside.",
  },
];

export function ClaimModal({
  target,
  isAdmin,
  onClose,
  onDone,
}: ClaimModalProps) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;

  const [action, setAction] = useState<WarrantyClaimActionInput>("REPAIR");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [unitId, setUnitId] = useState<number | null>(
    target.units[0]?.id ?? null,
  );
  const [replacementId, setReplacementId] = useState<number | null>(null);
  const [spares, setSpares] = useState<{ id: number; imei: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tracked = target.units.length > 0;
  // A repair's own warranty is honoured with another repair only.
  const repairOnly = target.maintenanceId != null;
  const needsSpare = action === "REPLACE" && tracked;

  useEffect(() => {
    if (!needsSpare || target.productId == null) return;
    let live = true;
    void (async () => {
      try {
        const rows = (await apiRef.current.productUnits.getForProduct(
          target.productId!,
          "IN_STOCK",
        )) as unknown as { id: number; imei: string }[];
        if (live) setSpares(Array.isArray(rows) ? rows : []);
      } catch {
        if (live) setSpares([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [needsSpare, target.productId]);

  const blocked =
    target.state === "VOID" ||
    target.state === "NONE" ||
    (target.state === "EXPIRED" && (!isAdmin || !reason.trim()));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const payload: CreateWarrantyClaimInput =
      target.maintenanceId != null
        ? {
            maintenance_id: target.maintenanceId,
            action: "REPAIR",
            client_day: localDay(),
          }
        : { sale_item_id: target.saleItemId!, action, client_day: localDay() };
    if (unitId != null) payload.unit_id = unitId;
    if (needsSpare && replacementId != null)
      payload.replacement_unit_id = replacementId;
    if (notes.trim()) payload.notes = notes.trim();
    if (target.state === "EXPIRED" && reason.trim())
      payload.override_reason = reason.trim();
    try {
      const res = await apiRef.current.createWarrantyClaim(payload);
      if (res.success) onDone();
      else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the claim");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Warranty claim"
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ShieldCheck size={18} className="text-violet-400" />
            Warranty claim — {target.productName}
          </h2>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {target.state === "VOID" && (
          <p className="text-sm text-red-300">
            This item was refunded — its warranty is void.
          </p>
        )}
        {target.state === "EXPIRED" && (
          <p className="text-sm text-amber-300">
            This warranty has expired.{" "}
            {isAdmin
              ? "Give a reason to honour it anyway."
              : "Only an admin can honour it."}
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-xs text-slate-400 mb-1">
            What will the shop do?
          </legend>
          {ACTIONS.map((a) => {
            const disabled = a.value !== "REPAIR" && (!isAdmin || repairOnly);
            return (
              <label
                key={a.value}
                className={`flex items-start gap-2 text-sm ${disabled ? "text-slate-500" : "text-slate-200"}`}
              >
                <input
                  type="radio"
                  name="claim-action"
                  aria-label={a.label}
                  value={a.value}
                  checked={action === a.value}
                  disabled={disabled}
                  onChange={() => setAction(a.value)}
                  className="mt-1 accent-violet-600"
                />
                <span>
                  <span className="font-medium">{a.label}</span>
                  <span className="block text-xs text-slate-400">{a.hint}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {target.units.length > 1 && (
          <div>
            <label
              htmlFor="claim-unit"
              className="text-xs text-slate-400 block mb-1"
            >
              Unit
            </label>
            <select
              id="claim-unit"
              value={unitId ?? ""}
              onChange={(e) => setUnitId(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              {target.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.serial ?? `#${u.id}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {needsSpare && (
          <div>
            <label
              htmlFor="claim-replacement"
              className="text-xs text-slate-400 block mb-1"
            >
              Replacement unit
            </label>
            <select
              id="claim-replacement"
              value={replacementId ?? ""}
              onChange={(e) =>
                setReplacementId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="">Pick the unit you hand over…</option>
              {spares.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.imei}
                </option>
              ))}
            </select>
          </div>
        )}

        {target.state === "EXPIRED" && isAdmin && (
          <div>
            <label
              htmlFor="claim-reason"
              className="text-xs text-slate-400 block mb-1"
            >
              Reason for honouring it
            </label>
            <input
              id="claim-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
        )}

        <div>
          <label
            htmlFor="claim-notes"
            className="text-xs text-slate-400 block mb-1"
          >
            Notes
          </label>
          <textarea
            id="claim-notes"
            value={notes}
            maxLength={500}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm text-red-300 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-300 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || blocked}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg"
          >
            {busy ? "Saving…" : "Start claim"}
          </button>
        </div>
      </div>
    </div>
  );
}
