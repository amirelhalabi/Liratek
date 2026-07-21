/**
 * Carrier Lines Manager (LIRA W6.a)
 *
 * Settings — CRUD for the shop's own alfa/mtc SIM lines: phone number,
 * label, credits, validity expiry. Informational only — no drawer legs,
 * no checkout/closing involvement.
 */

import { useState, useEffect, useCallback } from "react";
import { useApi } from "@liratek/ui";
import type { CarrierLineEntity } from "@liratek/ui";

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

export default function CarrierLinesManager() {
  const api = useApi();
  const [lines, setLines] = useState<CarrierLineEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [error, setError] = useState("");

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
                  {line.carrier}
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

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
              {error}
            </div>
          )}

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
    </div>
  );
}
