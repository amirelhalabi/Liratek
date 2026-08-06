/**
 * Carrier Lines Manager (LIRA W6.a)
 *
 * Settings — CRUD for the shop's own alfa/mtc SIM lines: phone number,
 * label, credits, validity expiry. Informational only — no drawer legs,
 * no checkout/closing involvement.
 *
 * Also owns the "Make primary" control (LIRA-090, TELECOM_DAYS_COST_PLAN
 * §6 step 4): at most one line per carrier can be primary. See
 * handleSetPrimary below for why this is more than bookkeeping.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useApi } from "@liratek/ui";
import type { CarrierLineEntity } from "@liratek/ui";
import {
  useMobileServiceItems,
  formatCatalogItemName,
  type ServiceItem,
} from "@/features/recharge/hooks/useMobileServiceItems";
// Shared with KatchForm.tsx's "Charge to shop line" item-card action
// (carrier-lines-validity plan Phase 5 / D5) — defined once per rule 14.
import { isSelfChargeEligible } from "@/features/recharge/utils/selfChargeEligibility";

interface FormData {
  carrier: "alfa" | "mtc";
  phone_number: string;
  label: string;
  credits: string;
  validity_expires_at: string;
  notes: string;
}

const EMPTY_FORM: FormData = {
  carrier: "mtc",
  phone_number: "",
  label: "",
  credits: "0",
  validity_expires_at: "",
  notes: "",
};

/** Result of a completed self-charge, held only long enough to show the
 *  operator what actually happened before they close the modal. */
interface ChargeResult {
  costLbp: number;
  creditsAdded: number;
  validityDaysAdded: number;
}

export default function CarrierLinesManager() {
  const api = useApi();
  const { items: catalogItems } = useMobileServiceItems();
  const [lines, setLines] = useState<CarrierLineEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [error, setError] = useState("");

  // ── Self-charge modal (LIRA-090 §5.2, TELECOM_DAYS_COST_PLAN §6 step 5) ──
  // Per-line action: charge a telecom catalog item to THIS SPECIFIC line,
  // extending its credits/validity — a shop-internal stock movement, not a
  // customer sale (owner note 12).
  const [chargeLine, setChargeLine] = useState<CarrierLineEntity | null>(null);
  const [chargeItemId, setChargeItemId] = useState<number | null>(null);
  const [chargeSubmitting, setChargeSubmitting] = useState(false);
  const [chargeError, setChargeError] = useState("");
  const [chargeResult, setChargeResult] = useState<ChargeResult | null>(null);

  const chargeCandidates = useMemo<ServiceItem[]>(() => {
    if (!chargeLine) return [];
    return catalogItems.filter((item) =>
      isSelfChargeEligible(item, chargeLine.carrier),
    );
  }, [catalogItems, chargeLine]);

  const chargeSelectedItem = useMemo(
    () => chargeCandidates.find((item) => item.id === chargeItemId) ?? null,
    [chargeCandidates, chargeItemId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminCarrierLines();
      setLines(data);
    } catch {
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  };

  const openEdit = (line: CarrierLineEntity) => {
    setEditingId(line.id);
    setForm({
      carrier: line.carrier,
      phone_number: line.phone_number,
      label: line.label ?? "",
      credits: String(line.credits ?? 0),
      validity_expires_at: line.validity_expires_at ?? "",
      notes: line.notes ?? "",
    });
    setError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    setError("");
    if (!form.phone_number.trim()) {
      setError("Phone number is required");
      return;
    }

    const payload = {
      carrier: form.carrier,
      phone_number: form.phone_number.trim(),
      label: form.label.trim() || null,
      credits: Number(form.credits) || 0,
      validity_expires_at: form.validity_expires_at || null,
      notes: form.notes.trim() || null,
    };

    try {
      const res = editingId
        ? await api.updateCarrierLine(editingId, payload)
        : await api.createCarrierLine(payload);
      if (!res.success) {
        setError(res.error || "Failed to save");
        return;
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    }
  };

  const handleArchive = async (line: CarrierLineEntity) => {
    if (!confirm(`Archive line "${line.label || line.phone_number}"?`)) return;
    try {
      await api.archiveCarrierLine(line.id);
      await load();
    } catch {
      // no-op — list simply won't refresh
    }
  };

  const handleToggleActive = async (line: CarrierLineEntity) => {
    try {
      await api.toggleCarrierLineActive(line.id);
      await load();
    } catch {
      // no-op
    }
  };

  // "Make primary" matters beyond bookkeeping: with no primary line set for
  // a carrier, an Only-Days sale on that carrier's items still books the
  // money correctly, but FinancialServiceRepository.processTelecomCreditReturn
  // has no line to attribute credits/validity to — it logs a warning and
  // moves on, so the carrier line credits/validity panel silently never
  // updates. This control is what makes that tracking work at all.
  const handleSetPrimary = async (line: CarrierLineEntity) => {
    setError("");
    try {
      const res = await api.setPrimaryCarrierLine(line.id);
      if (!res.success) {
        setError(res.error || "Failed to set primary line");
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set primary line");
    }
  };

  const openCharge = (line: CarrierLineEntity) => {
    setChargeLine(line);
    setChargeItemId(null);
    setChargeError("");
    setChargeResult(null);
  };

  const closeCharge = () => {
    setChargeLine(null);
    setChargeItemId(null);
    setChargeError("");
    setChargeResult(null);
  };

  // Writes a TELECOM_SELF_CHARGE transaction (FinancialServiceRepository
  // .selfChargeTelecomItem) — debits the item's own iPick/Katsh LBP drawer
  // and credits this line's credits/validity by the item's own `credits`/
  // `validity_days`. No arithmetic happens here; the repository owns it —
  // this only collects the item choice and reports what came back.
  const handleConfirmCharge = async () => {
    if (!chargeLine || !chargeSelectedItem?.id) return;
    setChargeSubmitting(true);
    setChargeError("");
    try {
      const res = await api.selfChargeTelecomItem({
        mobileServiceItemId: chargeSelectedItem.id,
        carrierLineId: chargeLine.id,
      });
      if (!res.success || !res.data) {
        setChargeError(res.error || "Self-charge failed");
        return;
      }
      setChargeResult({
        costLbp: res.data.costLbp,
        creditsAdded: res.data.creditsAdded,
        validityDaysAdded: res.data.validityDaysAdded,
      });
      await load();
    } catch (e) {
      setChargeError(e instanceof Error ? e.message : "Self-charge failed");
    } finally {
      setChargeSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-slate-400">Loading carrier lines...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold">Carrier Lines</h3>
          <p className="text-slate-400 text-sm">
            Track the shop's own alfa/mtc SIM numbers — remaining credits and
            validity expiry. Informational only; updates here don't affect any
            drawer or checkout.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-sm"
        >
          + Add Line
        </button>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
          {error}
        </div>
      )}

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="py-2 px-3">Carrier</th>
              <th className="py-2 px-3">Phone Number</th>
              <th className="py-2 px-3">Label</th>
              <th className="py-2 px-3">Credits</th>
              <th className="py-2 px-3">Validity Expires</th>
              <th className="py-2 px-3">Active</th>
              <th className="py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-slate-800">
                <td className="py-2 px-3 text-white uppercase text-xs">
                  <span className="flex items-center gap-1.5">
                    {line.carrier}
                    {/* Requires is_active too, deliberately: getPrimary()
                        carries the same is_active predicate, so an inactive
                        line is NOT the effective primary no matter what the
                        flag says. Both deactivation paths (archive() and
                        toggleActive()) now clear the flag at the repository,
                        so this should be unreachable — it is the belt to that
                        braces, in the same spirit as v140's H2 fix. Without
                        it, a stale row could claim "Primary" while the carrier
                        actually had none. */}
                    {line.is_primary === 1 && line.is_active === 1 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium normal-case bg-amber-500/20 text-amber-400">
                        Primary
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 px-3 text-white font-mono text-xs">
                  {line.phone_number}
                </td>
                <td className="py-2 px-3 text-slate-300">
                  {line.label || "—"}
                </td>
                <td className="py-2 px-3 text-emerald-400 font-mono">
                  ${line.credits}
                </td>
                <td className="py-2 px-3 text-slate-300 font-mono text-xs">
                  {line.validity_expires_at || "—"}
                </td>
                <td className="py-2 px-3">
                  <button
                    onClick={() => handleToggleActive(line)}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      line.is_active
                        ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                        : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                    }`}
                  >
                    {line.is_active ? "Active" : "Archived"}
                  </button>
                </td>
                <td className="py-2 px-3 flex gap-1">
                  <button
                    onClick={() => openEdit(line)}
                    className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs"
                  >
                    Edit
                  </button>
                  {/* Archived lines can never be primary — archive() clears
                      is_primary and getPrimary() requires is_active = 1 — so
                      offering this here would be a dead end. */}
                  {line.is_active === 1 && line.is_primary !== 1 && (
                    <button
                      onClick={() => handleSetPrimary(line)}
                      className="px-2 py-0.5 bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 rounded text-xs"
                    >
                      Make primary
                    </button>
                  )}
                  {line.is_active === 1 && (
                    <button
                      onClick={() => openCharge(line)}
                      className="px-2 py-0.5 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 rounded text-xs"
                    >
                      Charge item to this line
                    </button>
                  )}
                  {line.is_active === 1 && (
                    <button
                      onClick={() => handleArchive(line)}
                      className="px-2 py-0.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs"
                    >
                      Archive
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="py-4 px-3 text-center text-slate-500"
                >
                  No carrier lines yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="border border-slate-600 rounded-lg p-4 bg-slate-900/50 space-y-3">
          <h4 className="text-white font-medium">
            {editingId ? "Edit Carrier Line" : "New Carrier Line"}
          </h4>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs block mb-1">
                Carrier
              </label>
              <select
                value={form.carrier}
                onChange={(e) =>
                  setForm({
                    ...form,
                    carrier: e.target.value as "alfa" | "mtc",
                  })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
              >
                <option value="mtc">MTC</option>
                <option value="alfa">Alfa</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">
                Phone Number
              </label>
              <input
                type="text"
                value={form.phone_number}
                onChange={(e) =>
                  setForm({ ...form, phone_number: e.target.value })
                }
                placeholder="e.g. 03123456"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">
                Label (optional)
              </label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Shop Line 1"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">
                Credits ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.credits}
                onChange={(e) => setForm({ ...form, credits: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">
                Validity Expires
              </label>
              <input
                type="date"
                value={form.validity_expires_at}
                onChange={(e) =>
                  setForm({ ...form, validity_expires_at: e.target.value })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="text-slate-400 text-xs block mb-1">
                Notes (optional)
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-sm"
            >
              {editingId ? "Save Changes" : "Create"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {chargeLine && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-[460px] shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">
              Charge Item to This Line
            </h3>
            <p className="text-slate-400 text-xs mb-4">
              {chargeLine.carrier.toUpperCase()} —{" "}
              {chargeLine.label || chargeLine.phone_number}
            </p>

            {chargeResult ? (
              <div className="space-y-4">
                <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-3 text-sm text-emerald-300">
                  Charged successfully.
                </div>
                <div className="text-sm text-slate-300 space-y-1">
                  <p>
                    Cost debited:{" "}
                    <span className="text-white font-mono">
                      {chargeResult.costLbp.toLocaleString()} LBP
                    </span>
                  </p>
                  <p>
                    Credits added to this line:{" "}
                    <span className="text-emerald-400 font-mono">
                      +${chargeResult.creditsAdded}
                    </span>
                  </p>
                  <p>
                    Validity added to this line:{" "}
                    <span className="text-emerald-400 font-mono">
                      +{chargeResult.validityDaysAdded} days
                    </span>
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={closeCharge}
                    className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-sm"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {chargeError && (
                  <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
                    {chargeError}
                  </div>
                )}

                <div>
                  <label className="text-slate-400 text-xs block mb-1">
                    Telecom item ({chargeLine.carrier.toUpperCase()} only)
                  </label>
                  {chargeCandidates.length === 0 ? (
                    <p className="text-slate-500 text-sm">
                      No eligible {chargeLine.carrier.toUpperCase()} items —
                      self-charge needs an iPick/Katsh Prepaid item with both a
                      face credit and validity days configured.
                    </p>
                  ) : (
                    <select
                      value={chargeItemId ?? ""}
                      onChange={(e) =>
                        setChargeItemId(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
                    >
                      <option value="">Select an item…</option>
                      {chargeCandidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.provider} — {formatCatalogItemName(item)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {chargeSelectedItem && (
                  <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-sm text-slate-300 space-y-1">
                    <p className="text-slate-400 text-xs uppercase mb-1">
                      This will:
                    </p>
                    <p>
                      Debit{" "}
                      <span className="text-white font-mono">
                        {chargeSelectedItem.catalogCost?.toLocaleString()} LBP
                      </span>{" "}
                      from the {chargeSelectedItem.provider} drawer
                    </p>
                    <p>
                      Add{" "}
                      <span className="text-emerald-400 font-mono">
                        +${chargeSelectedItem.credits}
                      </span>{" "}
                      credit to this line
                    </p>
                    <p>
                      Add{" "}
                      <span className="text-emerald-400 font-mono">
                        +{chargeSelectedItem.validityDays} days
                      </span>{" "}
                      validity to this line
                    </p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleConfirmCharge}
                    disabled={!chargeSelectedItem || chargeSubmitting}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded text-sm"
                  >
                    {chargeSubmitting ? "Charging..." : "Confirm Charge"}
                  </button>
                  <button
                    onClick={closeCharge}
                    disabled={chargeSubmitting}
                    className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
