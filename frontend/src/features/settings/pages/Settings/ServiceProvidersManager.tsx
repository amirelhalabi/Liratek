/**
 * Service Providers Manager
 *
 * Settings > Modules & Drawers tab — CRUD for `service_providers`
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 5). Mirrors
 * `PaymentMethodsManager` shape-for-shape, with one deliberate difference:
 * there is NO drawer picker anywhere on this page. Every provider created
 * here always settles its cash to the `General` drawer (owner decision,
 * 2026-08-09: "all of them if paid cash will affect general drawer. only
 * the whish system association is linked to whish system drawer.") — the
 * server enforces this (`ServiceProviderService.createProvider` hardcodes
 * it), and the UI doesn't even offer a control that would suggest otherwise.
 *
 * The 9 seeded system providers (🔒: OMT, WHISH, BOB, OTHER, iPick, Katsh,
 * WHISH_APP, OMT_APP, BINANCE) cannot be deleted, and `code` can never be
 * edited for ANY provider (system or not) — `financial_services.provider`
 * FKs to `service_providers(tenant_id, code)` (v154), so renaming a code
 * already in use would orphan real money rows.
 *
 * LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — this screen ALSO surfaces
 * `suppliers.account_supplier_id` (the OMT open-credit account link, v176)
 * so a tenant can (re)parent iPick / OMT App / Whish App-style providers.
 * That column lives on `suppliers`, not `service_providers` — the two join
 * 1:1 on `suppliers.provider = service_providers.code` — so this component
 * additionally loads the suppliers list purely to resolve that join; a
 * provider with no matching supplier row (BOB/OTHER/BINANCE, or a custom
 * provider that was never turned into a ledger-bearing supplier) shows no
 * account control at all, since there is nothing to group.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useApi } from "@liratek/ui";
import type { ServiceProviderEntity } from "@liratek/ui";

interface FormData {
  code: string;
  label: string;
}

const EMPTY_FORM: FormData = {
  code: "",
  label: "",
};

/**
 * LIRA-191 — the minimal shape this screen reads off `api.getSuppliers()`.
 * That adapter fn is typed `Promise<any[]>` at the boundary
 * (`packages/ui/src/api/types.ts` — untyped everywhere it's consumed today);
 * a local, narrow interface here matches `Suppliers/index.tsx`'s own
 * precedent (its local `Supplier` interface) rather than threading `any`
 * through this component.
 */
interface SupplierRow {
  id: number;
  name: string;
  provider: string | null;
  is_active: number;
  account_supplier_id: number | null;
}

export default function ServiceProvidersManager() {
  const api = useApi();
  const [providers, setProviders] = useState<ServiceProviderEntity[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  // LIRA-191 — the edited provider's linked supplier's account-parent pick.
  // "" is the <select> sentinel for "standalone / no parent" (native
  // <select> values are always strings); parsed back to number|null on save.
  const [accountParentValue, setAccountParentValue] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, supplierList] = await Promise.all([
        api.getServiceProviders(),
        api.getSuppliers(undefined, true) as Promise<SupplierRow[]>,
      ]);
      setProviders(list);
      setSuppliers(supplierList ?? []);
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // LIRA-191 — the 1:1 join this screen is built on:
  // suppliers.provider = service_providers.code.
  const supplierByProviderCode = useMemo(() => {
    const map = new Map<string, SupplierRow>();
    for (const s of suppliers) {
      if (s.provider) map.set(s.provider, s);
    }
    return map;
  }, [suppliers]);

  const supplierNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of suppliers) map.set(s.id, s.name);
    return map;
  }, [suppliers]);

  // A supplier already pointed at by at least one other supplier IS an
  // account parent today — the same "has children" question
  // SupplierRepository.updateAccountLink checks server-side before letting
  // an existing parent become a child itself (no chains). Computed
  // client-side purely so the picker never OFFERS an option the server
  // would reject — the server re-validates regardless; this is UX only.
  const childCountBySupplierId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of suppliers) {
      if (s.account_supplier_id != null) {
        counts.set(
          s.account_supplier_id,
          (counts.get(s.account_supplier_id) ?? 0) + 1,
        );
      }
    }
    return counts;
  }, [suppliers]);

  const editingProvider = editingId
    ? (providers.find((p) => p.id === editingId) ?? null)
    : null;
  const linkedSupplier = editingProvider
    ? (supplierByProviderCode.get(editingProvider.code) ?? null)
    : null;
  const linkedSupplierHasChildren =
    !!linkedSupplier &&
    (childCountBySupplierId.get(linkedSupplier.id) ?? 0) > 0;

  // Eligible account-PARENT candidates: active, not itself a child, not the
  // supplier being edited.
  const eligibleParents = useMemo(() => {
    if (!linkedSupplier) return [];
    return suppliers
      .filter(
        (s) =>
          s.id !== linkedSupplier.id &&
          s.is_active === 1 &&
          s.account_supplier_id == null,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, linkedSupplier]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setAccountParentValue("");
    setError("");
    setShowForm(true);
  };

  const openEdit = (p: ServiceProviderEntity) => {
    setEditingId(p.id);
    setForm({ code: p.code, label: p.label });
    const supplier = supplierByProviderCode.get(p.code);
    setAccountParentValue(
      supplier?.account_supplier_id != null
        ? String(supplier.account_supplier_id)
        : "",
    );
    setError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    setError("");
    if (!form.label.trim() || (!editingId && !form.code.trim())) {
      setError("All fields are required");
      return;
    }

    try {
      if (editingId) {
        const res = await api.updateServiceProvider(editingId, {
          label: form.label,
        });
        if (!res.success) {
          setError(res.error || "Failed to update");
          return;
        }
        // LIRA-191 — only write the account link when this provider has a
        // matching supplier row, that supplier isn't itself an existing
        // account parent (no chains), and the picked value actually
        // changed (skip a needless write on a save that never touched it).
        if (linkedSupplier && !linkedSupplierHasChildren) {
          const nextParentId =
            accountParentValue === "" ? null : Number(accountParentValue);
          const currentParentId = linkedSupplier.account_supplier_id ?? null;
          if (nextParentId !== currentParentId) {
            const linkRes = await api.updateSupplierAccountLink({
              supplier_id: linkedSupplier.id,
              account_supplier_id: nextParentId,
            });
            if (!linkRes.success) {
              setError(linkRes.error || "Failed to update account grouping");
              return;
            }
          }
        }
      } else {
        const res = await api.createServiceProvider({
          code: form.code.toUpperCase().trim(),
          label: form.label.trim(),
        });
        if (!res.success) {
          setError(res.error || "Failed to create");
          return;
        }
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e.message || "Operation failed");
    }
  };

  const handleDelete = async (p: ServiceProviderEntity) => {
    if (p.is_system) return;
    if (!confirm(`Delete service provider "${p.label}"?`)) return;
    try {
      const res = await api.deleteServiceProvider(p.id);
      if (!res.success) {
        alert(res.error || "Failed to delete");
        return;
      }
      await load();
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  };

  const handleToggleActive = async (p: ServiceProviderEntity) => {
    try {
      await api.updateServiceProvider(p.id, {
        is_active: p.is_active ? 0 : 1,
      });
      await load();
    } catch {
      // Silently fail
    }
  };

  if (loading) {
    return <div className="text-slate-400">Loading service providers...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold">Service Providers</h3>
          <p className="text-slate-400 text-sm">
            Provider taxonomy for financial services (OMT/Whish/recharge
            transfers) and partner "System Association". New providers always
            settle cash to the General drawer.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-sm"
        >
          + Add Provider
        </button>
      </div>

      {/* Providers table */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="py-2 px-3">Code</th>
              <th className="py-2 px-3">Label</th>
              <th className="py-2 px-3">Drawer</th>
              {/* LIRA-191 — which open-credit account (if any) this
                  provider's supplier is grouped under. */}
              <th className="py-2 px-3">Account</th>
              <th className="py-2 px-3">Active</th>
              <th className="py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="py-2 px-3 text-white font-mono text-xs">
                  {p.code}
                  {p.is_system === 1 && (
                    <span className="ml-1 text-[10px] text-amber-400">🔒</span>
                  )}
                </td>
                <td className="py-2 px-3 text-white">{p.label}</td>
                <td className="py-2 px-3 text-slate-300 font-mono text-xs">
                  {p.drawer_name}
                </td>
                <td className="py-2 px-3 text-xs">
                  {(() => {
                    const supplier = supplierByProviderCode.get(p.code);
                    if (!supplier)
                      return <span className="text-slate-600">—</span>;
                    if (supplier.account_supplier_id == null)
                      return (
                        <span className="text-slate-500">Standalone</span>
                      );
                    return (
                      <span className="text-violet-300">
                        {supplierNameById.get(supplier.account_supplier_id) ??
                          `#${supplier.account_supplier_id}`}
                      </span>
                    );
                  })()}
                </td>
                <td className="py-2 px-3">
                  <button
                    onClick={() => handleToggleActive(p)}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      p.is_active
                        ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                        : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                    }`}
                  >
                    {p.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="py-2 px-3 flex gap-1">
                  <button
                    onClick={() => openEdit(p)}
                    className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs"
                  >
                    Edit
                  </button>
                  {!p.is_system && (
                    <button
                      onClick={() => handleDelete(p)}
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
            {editingId ? "Edit Service Provider" : "New Service Provider"}
          </h4>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="service-provider-code"
                className="text-slate-400 text-xs block mb-1"
              >
                Code (uppercase, unique)
              </label>
              <input
                id="service-provider-code"
                type="text"
                disabled={!!editingId}
                value={form.code}
                onChange={(e) =>
                  setForm({
                    ...form,
                    code: e.target.value.toUpperCase().replace(/\s/g, "_"),
                  })
                }
                placeholder="e.g. SYRIA"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="service-provider-label"
                className="text-slate-400 text-xs block mb-1"
              >
                Display Label
              </label>
              <input
                id="service-provider-label"
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Syria"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
          </div>

          {!editingId && (
            <p className="text-xs text-slate-500 italic">
              This provider's cash will settle to the General drawer. Only OMT
              and Whish have their own dedicated system drawer.
            </p>
          )}

          {/* LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — account
              grouping only applies to a provider with a matching `suppliers`
              row (the join this whole feature is built on). */}
          {editingId && linkedSupplier && (
            <div>
              <label
                htmlFor="service-provider-account-parent"
                className="text-slate-400 text-xs block mb-1"
              >
                Part of account (optional)
              </label>
              {linkedSupplierHasChildren ? (
                <p className="text-xs text-amber-400">
                  "{linkedSupplier.name}" already has its own children
                  grouped under it — an account parent cannot also become a
                  child.
                </p>
              ) : (
                <>
                  <select
                    id="service-provider-account-parent"
                    value={accountParentValue}
                    onChange={(e) => setAccountParentValue(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm"
                  >
                    <option value="">Standalone (no account)</option>
                    {eligibleParents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Draws on that supplier's open-credit account instead of
                    settling on its own (e.g. iPick / OMT App under OMT).
                  </p>
                </>
              )}
            </div>
          )}
          {editingId && !linkedSupplier && (
            <p className="text-xs text-slate-500 italic">
              No supplier ledger is linked to this provider — account
              grouping doesn't apply.
            </p>
          )}

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
        System providers (🔒) cannot be deleted. A provider's code can never be
        changed once created.
      </p>
    </div>
  );
}
