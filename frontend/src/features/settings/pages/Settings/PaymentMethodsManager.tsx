/**
 * Payment Methods Manager
 *
 * Settings > Modules & Drawers tab — CRUD for payment methods.
 * Allows admins to create, edit, and delete payment methods.
 * System methods (CASH, DEBT) cannot be deleted.
 */

import { useState, useEffect, useCallback } from "react";
import { useApi } from "@liratek/ui";
import type { PaymentMethodEntity } from "@liratek/ui";

interface FormData {
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer: boolean;
}

const EMPTY_FORM: FormData = {
  code: "",
  label: "",
  drawer_name: "General",
  affects_drawer: true,
};

export default function PaymentMethodsManager() {
  const api = useApi();
  const [methods, setMethods] = useState<PaymentMethodEntity[]>([]);
  const [drawers, setDrawers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, d] = await Promise.all([
        api.getPaymentMethods(),
        api.getConfiguredDrawerNames(),
      ]);
      setMethods(m);
      setDrawers(d);
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  };

  const openEdit = (m: PaymentMethodEntity) => {
    setEditingId(m.id);
    setForm({
      code: m.code,
      label: m.label,
      drawer_name: m.drawer_name,
      affects_drawer: m.affects_drawer === 1,
    });
    setError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    setError("");
    if (!form.code.trim() || !form.label.trim() || !form.drawer_name.trim()) {
      setError("All fields are required");
      return;
    }

    try {
      if (editingId) {
        const res = await api.updatePaymentMethod(editingId, {
          label: form.label,
          drawer_name: form.drawer_name,
          affects_drawer: form.affects_drawer ? 1 : 0,
        });
        if (!res.success) {
          setError(res.error || "Failed to update");
          return;
        }
      } else {
        const res = await api.createPaymentMethod({
          code: form.code.toUpperCase().trim(),
          label: form.label.trim(),
          drawer_name: form.drawer_name,
          affects_drawer: form.affects_drawer ? 1 : 0,
        });
        if (!res.success) {
          setError(res.error || "Failed to create");
          return;
        }
      }
      setShowForm(false);
      window.dispatchEvent(new Event("payment-methods-changed"));
      await load();
    } catch (e: any) {
      setError(e.message || "Operation failed");
    }
  };

  const handleDelete = async (m: PaymentMethodEntity) => {
    if (m.is_system) return;
    if (!confirm(`Delete payment method "${m.label}"?`)) return;
    try {
      const res = await api.deletePaymentMethod(m.id);
      if (!res.success) {
        alert(res.error || "Failed to delete");
        return;
      }
      window.dispatchEvent(new Event("payment-methods-changed"));
      await load();
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  };

  const handleToggleActive = async (m: PaymentMethodEntity) => {
    try {
      await api.updatePaymentMethod(m.id, {
        is_active: m.is_active ? 0 : 1,
      });
      window.dispatchEvent(new Event("payment-methods-changed"));
      await load();
    } catch {
      // Silently fail
    }
  };

  if (loading) {
    return <div className="text-slate-400">Loading payment methods...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold">Payment Methods</h3>
          <p className="text-slate-400 text-sm">
            Configure which payment methods are available across all features.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-sm"
        >
          + Add Method
        </button>
      </div>

      {/* Methods table */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="py-2 px-3">Code</th>
              <th className="py-2 px-3">Label</th>
              <th className="py-2 px-3">Drawer</th>
              <th className="py-2 px-3">Affects Drawer</th>
              <th className="py-2 px-3">Active</th>
              <th className="py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.id} className="border-t border-slate-800">
                <td className="py-2 px-3 text-white font-mono text-xs">
                  {m.code}
                  {m.is_system === 1 && (
                    <span className="ml-1 text-[10px] text-amber-400">🔒</span>
                  )}
                </td>
                <td className="py-2 px-3 text-white">{m.label}</td>
                <td className="py-2 px-3 text-slate-300 font-mono text-xs">
                  {m.drawer_name}
                </td>
                <td className="py-2 px-3">
                  {m.affects_drawer ? (
                    <span className="text-green-400">Yes</span>
                  ) : (
                    <span className="text-slate-500">No</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <button
                    onClick={() => handleToggleActive(m)}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      m.is_active
                        ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                        : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                    }`}
                  >
                    {m.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="py-2 px-3 flex gap-1">
                  <button
                    onClick={() => openEdit(m)}
                    className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs"
                  >
                    Edit
                  </button>
                  {!m.is_system && (
                    <button
                      onClick={() => handleDelete(m)}
                      className="px-2 py-0.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="border border-slate-600 rounded-lg p-4 bg-slate-900/50 space-y-3">
          <h4 className="text-white font-medium">
            {editingId ? "Edit Payment Method" : "New Payment Method"}
          </h4>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="payment-method-code"
                className="text-slate-400 text-xs block mb-1"
              >
                Code (uppercase, unique)
              </label>
              <input
                id="payment-method-code"
                type="text"
                disabled={!!editingId}
                value={form.code}
                onChange={(e) =>
                  setForm({
                    ...form,
                    code: e.target.value.toUpperCase().replace(/\s/g, "_"),
                  })
                }
                placeholder="e.g. PAYPAL"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="payment-method-label"
                className="text-slate-400 text-xs block mb-1"
              >
                Display Label
              </label>
              <input
                id="payment-method-label"
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. PayPal"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="payment-method-drawer"
                className="text-slate-400 text-xs block mb-1"
              >
                Drawer
              </label>
              <select
                id="payment-method-drawer"
                value={form.drawer_name}
                onChange={(e) =>
                  setForm({ ...form, drawer_name: e.target.value })
                }
                disabled={
                  !!editingId &&
                  methods.find((m) => m.id === editingId)?.is_system === 1
                }
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm disabled:opacity-50"
              >
                {drawers.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.affects_drawer}
                  onChange={(e) =>
                    setForm({ ...form, affects_drawer: e.target.checked })
                  }
                  disabled={
                    !!editingId &&
                    methods.find((m) => m.id === editingId)?.is_system === 1
                  }
                  className="rounded"
                />
                <span className="text-slate-300 text-sm">Affects Drawer</span>
              </label>
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

      <p className="text-xs text-slate-500 italic">
        System methods (🔒) cannot be deleted. DEBT does not affect any drawer
        balance.
      </p>
    </div>
  );
}
