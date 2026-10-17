import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { normalizeDigits } from "@liratek/ui/i18n/digits";
import { categoryLabel } from "@/features/inventory/categoryLabel";
import { Plus, Pencil, Trash2, Check, X, Tag, Truck } from "lucide-react";
import { DataTable, useApi } from "@liratek/ui";
import {
  serialLabelFor,
  warrantyMonthsSchema,
  type SerialLabel,
  type SerialRequiredMode,
} from "@liratek/core";

interface Category {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  // LIRA-143 Phase 5/6b — decision #9's per-category IMEI-tracking flag.
  tracks_imei_units: number;
  // LIRA-296 — the category's default warranty in months; null = none.
  warranty_months?: number | null;
  // LIRA-296 P3 — what the serial is called, and the rule for a sale
  // without one. Missing on an older backend: derived / BLOCK.
  serial_label?: string | null;
  serial_required?: string | null;
}

/**
 * LIRA-296 — one category's "Default warranty (months)" box. Empty means
 * "No warranty". Saves on blur or Enter, only when the value changed; the
 * range check is core's own `warrantyMonthsSchema` (rule 14).
 */
function CategoryWarrantyInput({
  category,
  onSave,
  onInvalid,
}: {
  category: Category;
  onSave: (months: number | null) => void;
  onInvalid: (message: string) => void;
}) {
  const { t, i18n } = useTranslation("settingsCatalog");
  // The parent keys this box by the saved value, so a reload re-seeds it.
  const current = category.warranty_months ?? null;
  const [value, setValue] = useState(current === null ? "" : String(current));

  const commit = () => {
    const trimmed = normalizeDigits(value).trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && !warrantyMonthsSchema.safeParse(next).success) {
      onInvalid(t("categories.warrantyRange"));
      return;
    }
    if (next !== current) onSave(next);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      placeholder={t("categories.noWarranty")}
      aria-label={t("categories.warrantyAria", {
        name: categoryLabel(category.name, i18n.language),
      })}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-28 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm text-center focus:outline-none focus:border-violet-500"
    />
  );
}

interface ProductSupplier {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  product_count: number;
}

export default function CategoriesManager() {
  const api = useApi();
  const { t, i18n } = useTranslation("settingsCatalog");
  /** OD-3: a seeded category name shows translated; the stored name is data. */
  const shown = (name: string) => categoryLabel(name, i18n.language);

  // ── Categories state ───────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const allSelected =
    categories.length > 0 && selectedIds.size === categories.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleOne = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  // ── Suppliers state ────────────────────────────────────────────────
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [suppLoading, setSuppLoading] = useState(false);
  const [newSuppName, setNewSuppName] = useState("");
  const [suppEditingId, setSuppEditingId] = useState<number | null>(null);
  const [suppEditingName, setSuppEditingName] = useState("");
  const [suppError, setSuppError] = useState("");

  const [suppSelectedIds, setSuppSelectedIds] = useState<Set<number>>(
    new Set(),
  );
  const suppAllSelected =
    suppliers.length > 0 && suppSelectedIds.size === suppliers.length;
  const suppSomeSelected = suppSelectedIds.size > 0 && !suppAllSelected;

  const toggleOneSupp = (id: number) =>
    setSuppSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  // ── Load categories ────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getCategoriesFull();
      setCategories(data ?? []);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
    }
  };

  // ── Load suppliers ─────────────────────────────────────────────────
  const loadSuppliers = async () => {
    setSuppLoading(true);
    try {
      // Rule 19: was a raw, optional-chained
      // `window.api?.inventory.getProductSuppliersFull()` — silently
      // resolved to `undefined` in a real browser, so this tab looked empty
      // on the web. `api.getProductSuppliersFull` routes IPC/REST for both
      // transports.
      const data = await api.getProductSuppliersFull();
      setSuppliers(data ?? []);
      setSuppSelectedIds(new Set());
    } finally {
      setSuppLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadSuppliers();
  }, []);

  // ── Category CRUD ──────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!newName.trim()) return;
    setError("");
    const res = await api.createCategory(newName.trim());
    if (res?.success) {
      setNewName("");
      load();
    } else setError(res?.error ?? t("categories.createFailed"));
  };

  const handleUpdate = async (id: number) => {
    if (!editingName.trim()) return;
    setError("");
    const res = await api.updateCategory(id, { name: editingName.trim() });
    if (res?.success) {
      setEditingId(null);
      load();
    } else setError(res?.error ?? t("categories.updateFailed"));
  };

  // LIRA-143 Phase 6b — decision #9's per-category IMEI-tracking toggle.
  const handleToggleTracksImei = async (cat: Category) => {
    setError("");
    const nextValue = cat.tracks_imei_units !== 1;
    const res = await api.updateCategory(cat.id, {
      tracks_imei_units: nextValue,
    });
    if (res?.success) load();
    else setError(res?.error ?? t("categories.updateFailed"));
  };

  // LIRA-296 — the category's default warranty (null = no warranty).
  const handleWarrantyMonths = async (cat: Category, months: number | null) => {
    setError("");
    const res = await api.updateCategory(cat.id, { warranty_months: months });
    if (res?.success) load();
    else setError(res?.error ?? t("categories.updateFailed"));
  };

  // LIRA-296 P3 — the serial name and the sale-without-serial rule.
  const handleSerial = async (
    cat: Category,
    patch: { serial_label: SerialLabel } | { serial_required: SerialRequiredMode },
  ) => {
    setError("");
    const res = await api.updateCategory(cat.id, patch);
    if (res?.success) load();
    else setError(res?.error ?? t("categories.updateFailed"));
  };

  const handleDelete = async (id: number, name: string) => {
    if (
      !confirm(t("categories.deleteConfirm", { name: shown(name) }))
    )
      return;
    const res = await api.deleteCategory(id);
    if (res?.success) load();
    else setError(res?.error ?? t("categories.deleteFailed"));
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        t("categories.batchDeleteConfirm", { count: selectedIds.size }),
      )
    )
      return;
    setError("");
    let failed = 0;
    for (const id of selectedIds) {
      const res = await api.deleteCategory(id);
      if (!res?.success) failed++;
    }
    if (failed > 0)
      setError(t("categories.batchFailed", { count: failed }));
    load();
  };

  // ── Supplier CRUD ──────────────────────────────────────────────────
  const handleAddSupplier = async () => {
    if (!newSuppName.trim()) return;
    setSuppError("");
    // Rule 19: was a raw, optional-chained
    // `window.api?.inventory.createProductSupplier(...)` — silently
    // no-op'd on the web (product-supplier CRUD never reached the server).
    // `api.createProductSupplier` routes IPC/REST for both transports.
    const res = await api.createProductSupplier(newSuppName.trim());
    if (res?.success) {
      setNewSuppName("");
      loadSuppliers();
    } else setSuppError(res?.error ?? t("suppliers.createFailed"));
  };

  const handleUpdateSupplier = async (id: number) => {
    if (!suppEditingName.trim()) return;
    setSuppError("");
    // Rule 19: was a raw, optional-chained
    // `window.api?.inventory.updateProductSupplier(...)` — silently no-op'd
    // on the web. `api.updateProductSupplier` routes IPC/REST for both
    // transports.
    const res = await api.updateProductSupplier(id, suppEditingName.trim());
    if (res?.success) {
      setSuppEditingId(null);
      loadSuppliers();
    } else setSuppError(res?.error ?? t("categories.updateFailed"));
  };

  const handleDeleteSupplier = async (id: number, name: string) => {
    if (
      !confirm(t("suppliers.deleteConfirm", { name }))
    )
      return;
    // Rule 19: was a raw, optional-chained
    // `window.api?.inventory.deleteProductSupplier(...)` — silently no-op'd
    // on the web. `api.deleteProductSupplier` routes IPC/REST for both
    // transports.
    const res = await api.deleteProductSupplier(id);
    if (res?.success) loadSuppliers();
    else setSuppError(res?.error ?? t("categories.deleteFailed"));
  };

  const handleBatchDeleteSuppliers = async () => {
    if (suppSelectedIds.size === 0) return;
    if (
      !confirm(
        t("suppliers.batchDeleteConfirm", { count: suppSelectedIds.size }),
      )
    )
      return;
    setSuppError("");
    let failed = 0;
    // Rule 19: was a raw, optional-chained
    // `window.api?.inventory.deleteProductSupplier(...)` — on the web
    // `window.api` is undefined, so `res` resolved to `undefined` every
    // iteration and `failed++` fired for every supplier without ever
    // reaching the server. `api.deleteProductSupplier` routes IPC/REST for
    // both transports.
    for (const id of suppSelectedIds) {
      const res = await api.deleteProductSupplier(id);
      if (!res?.success) failed++;
    }
    if (failed > 0)
      setSuppError(t("suppliers.batchFailed", { count: failed }));
    loadSuppliers();
  };

  return (
    <div className="space-y-8">
      {/* ── Categories Section ──────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Tag size={16} className="text-violet-400" />
          <span className="text-sm font-semibold text-white">
            {t("categories.title")}
          </span>
          <span className="text-xs text-slate-500 ms-1">
            {t("categories.count", { count: categories.length })}
          </span>
        </div>

        {error && (
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
            {error}
          </div>
        )}

        {/* Add new category */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={t("categories.newPlaceholder")}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={15} /> {t("categories.add")}
          </button>
        </div>

        {/* Categories DataTable */}
        <div className="border border-slate-700 rounded-xl overflow-hidden">
          <DataTable<Category>
            headerActions={
              selectedIds.size > 0 ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700/50 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
                    title={t("categories.clearSelection")}
                  >
                    <X size={14} />
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                    {t("categories.deleteSelected", { n: selectedIds.size })}
                  </button>
                </div>
              ) : undefined
            }
            columns={[
              {
                header: "",
                className: "p-3 border-b border-slate-700",
                width: "44px",
              },
              {
                header: t("categories.col.name"),
                sortKey: "name",
                className: "p-3 border-b border-slate-700",
              },
              {
                header: t("categories.col.tracks"),
                className: "p-3 border-b border-slate-700 text-center",
                width: "190px",
              },
              {
                header: t("categories.col.warranty"),
                className: "p-3 border-b border-slate-700 text-center",
                width: "170px",
              },
              {
                header: t("categories.col.actions"),
                className: "p-3 border-b border-slate-700 text-end",
                width: "100px",
              },
            ]}
            data={categories}
            loading={loading}
            emptyMessage={t("categories.empty")}
            paginate
            pageSize={10}
            pageLabel={t("categories.pageLabel")}
            exportExcel
            exportPdf
            exportFilename="categories"
            defaultSortKey="name"
            selectAll={{
              checked: allSelected,
              indeterminate: someSelected,
              onChange: (checked) =>
                setSelectedIds(
                  checked ? new Set(categories.map((c) => c.id)) : new Set(),
                ),
            }}
            className="w-full text-start"
            theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
            tbodyClassName="divide-y divide-slate-700/50"
            renderRow={(cat) => {
              const isSelected = selectedIds.has(cat.id);
              const isEditing = editingId === cat.id;
              return (
                <tr
                  key={cat.id}
                  className={`transition-colors ${isSelected ? "bg-red-900/10" : "hover:bg-slate-800/50"}`}
                >
                  {/* Checkbox */}
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(cat.id)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-violet-600 cursor-pointer"
                    />
                  </td>

                  {/* Name / edit input */}
                  <td className="p-3">
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdate(cat.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="w-full bg-slate-800 border border-violet-500 rounded px-2 py-1 text-white text-sm focus:outline-none"
                      />
                    ) : (
                      <span className="text-sm text-slate-200">{shown(cat.name)}</span>
                    )}
                  </td>

                  {/* Tracks IMEI units toggle (LIRA-143 decision #9) */}
                  <td
                    className="p-3 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-checked={cat.tracks_imei_units === 1}
                      onClick={() => handleToggleTracksImei(cat)}
                      title={t("categories.tracksTitle")}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                        cat.tracks_imei_units === 1
                          ? "bg-violet-600"
                          : "bg-slate-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          cat.tracks_imei_units === 1
                            ? "translate-x-4"
                            : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    {/* LIRA-296 P3 — serial name and the sale-without-serial rule */}
                    {cat.tracks_imei_units === 1 && (
                      <div className="mt-2 flex flex-col gap-1 items-center">
                        <select
                          aria-label={t("categories.serialNameAria", {
                            name: shown(cat.name),
                          })}
                          value={serialLabelFor(cat)}
                          onChange={(e) =>
                            void handleSerial(cat, {
                              serial_label: e.target.value as SerialLabel,
                            })
                          }
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-white"
                        >
                          <option value="IMEI">{t("categories.calledImei")}</option>
                          <option value="Serial">
                            {t("categories.calledSerial")}
                          </option>
                        </select>
                        <select
                          aria-label={t("categories.noSerialAria", {
                            name: shown(cat.name),
                          })}
                          value={
                            cat.serial_required === "WARN" ? "WARN" : "BLOCK"
                          }
                          onChange={(e) =>
                            void handleSerial(cat, {
                              serial_required: e.target
                                .value as SerialRequiredMode,
                            })
                          }
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-white"
                        >
                          <option value="BLOCK">
                            {t("categories.noSerialBlock")}
                          </option>
                          <option value="WARN">
                            {t("categories.noSerialWarn")}
                          </option>
                        </select>
                      </div>
                    )}
                  </td>

                  {/* LIRA-296 — default warranty for the category */}
                  <td
                    className="p-3 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CategoryWarrantyInput
                      key={`${cat.id}:${cat.warranty_months ?? ""}`}
                      category={cat}
                      onSave={(months) => handleWarrantyMonths(cat, months)}
                      onInvalid={setError}
                    />
                  </td>

                  {/* Actions */}
                  <td className="p-3 text-end">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => handleUpdate(cat.id)}
                            className="text-emerald-400 hover:text-emerald-300 p-1.5 transition-colors"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-slate-500 hover:text-slate-300 p-1.5 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(cat.id);
                              setEditingName(cat.name);
                            }}
                            className="text-slate-400 hover:text-blue-400 p-1.5 transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(cat.id, cat.name)}
                            className="text-slate-400 hover:text-red-400 p-1.5 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            }}
          />
        </div>
      </div>

      {/* ── Product Suppliers Section ───────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Truck size={16} className="text-sky-400" />
          <span className="text-sm font-semibold text-white">
            {t("suppliers.title")}
          </span>
          <span className="text-xs text-slate-500 ms-1">
            {t("suppliers.count", { count: suppliers.length })}
          </span>
        </div>

        {suppError && (
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
            {suppError}
          </div>
        )}

        {/* Add new supplier */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newSuppName}
            onChange={(e) => setNewSuppName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddSupplier()}
            placeholder={t("suppliers.newPlaceholder")}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
          />
          <button
            onClick={handleAddSupplier}
            disabled={!newSuppName.trim()}
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={15} /> {t("categories.add")}
          </button>
        </div>

        {/* Suppliers DataTable */}
        <div className="border border-slate-700 rounded-xl overflow-hidden">
          <DataTable<ProductSupplier>
            headerActions={
              suppSelectedIds.size > 0 ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSuppSelectedIds(new Set())}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700/50 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
                    title={t("categories.clearSelection")}
                  >
                    <X size={14} />
                  </button>
                  <button
                    onClick={handleBatchDeleteSuppliers}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                    {t("categories.deleteSelected", { n: suppSelectedIds.size })}
                  </button>
                </div>
              ) : undefined
            }
            columns={[
              {
                header: "",
                className: "p-3 border-b border-slate-700",
                width: "44px",
              },
              {
                header: t("suppliers.col.name"),
                sortKey: "name",
                className: "p-3 border-b border-slate-700",
              },
              {
                header: t("suppliers.col.products"),
                sortKey: "product_count",
                className: "p-3 border-b border-slate-700",
                width: "100px",
              },
              {
                header: t("categories.col.actions"),
                className: "p-3 border-b border-slate-700 text-end",
                width: "100px",
              },
            ]}
            data={suppliers}
            loading={suppLoading}
            emptyMessage={t("suppliers.empty")}
            paginate
            pageSize={10}
            pageLabel={t("suppliers.pageLabel")}
            exportExcel
            exportPdf
            exportFilename="product-suppliers"
            defaultSortKey="name"
            selectAll={{
              checked: suppAllSelected,
              indeterminate: suppSomeSelected,
              onChange: (checked) =>
                setSuppSelectedIds(
                  checked ? new Set(suppliers.map((s) => s.id)) : new Set(),
                ),
            }}
            className="w-full text-start"
            theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
            tbodyClassName="divide-y divide-slate-700/50"
            renderRow={(supp) => {
              const isSelected = suppSelectedIds.has(supp.id);
              const isEditing = suppEditingId === supp.id;
              return (
                <tr
                  key={supp.id}
                  className={`transition-colors ${isSelected ? "bg-red-900/10" : "hover:bg-slate-800/50"}`}
                >
                  {/* Checkbox */}
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOneSupp(supp.id)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-sky-600 cursor-pointer"
                    />
                  </td>

                  {/* Name / edit input */}
                  <td className="p-3">
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        value={suppEditingName}
                        onChange={(e) => setSuppEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdateSupplier(supp.id);
                          if (e.key === "Escape") setSuppEditingId(null);
                        }}
                        className="w-full bg-slate-800 border border-sky-500 rounded px-2 py-1 text-white text-sm focus:outline-none"
                      />
                    ) : (
                      <span className="text-sm text-slate-200">
                        {supp.name}
                      </span>
                    )}
                  </td>

                  {/* Product count */}
                  <td className="p-3">
                    <span className="text-xs text-slate-400">
                      {supp.product_count}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="p-3 text-end">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => handleUpdateSupplier(supp.id)}
                            className="text-emerald-400 hover:text-emerald-300 p-1.5 transition-colors"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => setSuppEditingId(null)}
                            className="text-slate-500 hover:text-slate-300 p-1.5 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setSuppEditingId(supp.id);
                              setSuppEditingName(supp.name);
                            }}
                            className="text-slate-400 hover:text-blue-400 p-1.5 transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() =>
                              handleDeleteSupplier(supp.id, supp.name)
                            }
                            className="text-slate-400 hover:text-red-400 p-1.5 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}
