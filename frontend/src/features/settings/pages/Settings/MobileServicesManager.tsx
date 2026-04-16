/**
 * Mobile Services Manager
 *
 * Settings tab — CRUD for mobile service catalog items.
 * Hierarchical collapsible view: Provider → Category → Subcategory → Items
 * Each item is an inline-editable row with cost/sell/label fields.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
  Smartphone,
  ChevronDown,
  FolderPlus,
} from "lucide-react";
import type { MobileServiceItem } from "@/types/electron";
import { parseCatalogToSeedData } from "@/features/recharge/utils/parseCatalogToSeedData";

const PROVIDERS = ["iPick", "Katsh", "WISH_APP", "OMT_APP", "VOUCHER"] as const;

const PROVIDER_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  iPick: {
    bg: "bg-emerald-600/10",
    text: "text-emerald-400",
    border: "border-emerald-600/30",
  },
  Katsh: {
    bg: "bg-violet-600/10",
    text: "text-violet-400",
    border: "border-violet-600/30",
  },
  WISH_APP: {
    bg: "bg-sky-600/10",
    text: "text-sky-400",
    border: "border-sky-600/30",
  },
  OMT_APP: {
    bg: "bg-amber-600/10",
    text: "text-amber-400",
    border: "border-amber-600/30",
  },
  VOUCHER: {
    bg: "bg-pink-600/10",
    text: "text-pink-400",
    border: "border-pink-600/30",
  },
};

interface EditingState {
  id: number;
  label: string;
  cost_lbp: string;
  sell_lbp: string;
  sort_order: string;
}

interface NewItemForm {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: string;
  sell_lbp: string;
  sort_order: string;
}

const EMPTY_NEW_ITEM: NewItemForm = {
  provider: "",
  category: "",
  subcategory: "",
  label: "",
  cost_lbp: "",
  sell_lbp: "",
  sort_order: "0",
};

/** Grouped data structure */
interface GroupedData {
  provider: string;
  categories: {
    name: string;
    subcategories: {
      name: string;
      items: MobileServiceItem[];
    }[];
  }[];
}

export default function MobileServicesManager() {
  const [items, setItems] = useState<MobileServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter
  const [providerFilter, setProviderFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  // Collapse state
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(
    new Set(),
  );
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [collapsedSubcategories, setCollapsedSubcategories] = useState<
    Set<string>
  >(new Set());

  // Inline editing
  const [editing, setEditing] = useState<EditingState | null>(null);

  // New item / new category / new subcategory
  const [newItemForm, setNewItemForm] = useState<NewItemForm | null>(null);
  const [newCategoryInput, setNewCategoryInput] = useState<{
    provider: string;
    value: string;
  } | null>(null);
  const [newSubcategoryInput, setNewSubcategoryInput] = useState<{
    provider: string;
    category: string;
    value: string;
  } | null>(null);

  // ── Load ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const countRes = await window.api.mobileServiceItems.count();
      if (countRes.success && countRes.data === 0) {
        const seedData = parseCatalogToSeedData();
        await window.api.mobileServiceItems.seed(seedData);
      }
      const res = await window.api.mobileServiceItems.getAllAdmin();
      if (res.success) {
        setItems(res.data ?? []);
      } else {
        setError(res.error ?? "Failed to load items");
      }
    } catch {
      setError("Failed to load mobile service items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Filter + search ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (providerFilter && item.provider !== providerFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.subcategory.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, providerFilter, searchQuery]);

  // ── Group into hierarchy ────────────────────────────────────────────
  const grouped = useMemo<GroupedData[]>(() => {
    const provMap = new Map<
      string,
      Map<string, Map<string, MobileServiceItem[]>>
    >();

    for (const item of filtered) {
      if (!provMap.has(item.provider)) provMap.set(item.provider, new Map());
      const catMap = provMap.get(item.provider)!;
      if (!catMap.has(item.category)) catMap.set(item.category, new Map());
      const subMap = catMap.get(item.category)!;
      if (!subMap.has(item.subcategory)) subMap.set(item.subcategory, []);
      subMap.get(item.subcategory)!.push(item);
    }

    // Sort items within each subcategory by sort_order
    const result: GroupedData[] = [];
    for (const prov of PROVIDERS) {
      const catMap = provMap.get(prov);
      if (!catMap) continue;
      const categories = Array.from(catMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([catName, subMap]) => ({
          name: catName,
          subcategories: Array.from(subMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([subName, subItems]) => ({
              name: subName,
              items: subItems.sort((a, b) => a.sort_order - b.sort_order),
            })),
        }));
      result.push({ provider: prov, categories });
    }
    return result;
  }, [filtered]);

  // ── Collapse toggles ───────────────────────────────────────────────
  const toggleProvider = (key: string) =>
    setCollapsedProviders((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const toggleCategory = (key: string) =>
    setCollapsedCategories((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const toggleSubcategory = (key: string) =>
    setCollapsedSubcategories((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // ── CRUD handlers ──────────────────────────────────────────────────
  const handleSaveEdit = async () => {
    if (!editing) return;
    setError("");
    const costLbp = parseInt(editing.cost_lbp, 10);
    const sellLbp = parseInt(editing.sell_lbp, 10);
    if (isNaN(costLbp) || isNaN(sellLbp)) {
      setError("Cost and sell must be valid numbers");
      return;
    }
    try {
      const res = await window.api.mobileServiceItems.update(editing.id, {
        label: editing.label.trim(),
        cost_lbp: costLbp,
        sell_lbp: sellLbp,
        sort_order: parseInt(editing.sort_order, 10) || 0,
      });
      if (!res.success) {
        setError(res.error ?? "Failed to update");
        return;
      }
      setEditing(null);
      await load();
    } catch {
      setError("Update failed");
    }
  };

  const handleDelete = async (item: MobileServiceItem) => {
    if (!confirm(`Delete "${item.label}" from ${item.subcategory}?`)) return;
    try {
      const res = await window.api.mobileServiceItems.delete(item.id);
      if (!res.success) setError(res.error ?? "Failed to delete");
      else await load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleToggleActive = async (item: MobileServiceItem) => {
    try {
      await window.api.mobileServiceItems.toggleActive(item.id);
      await load();
    } catch {
      // silent
    }
  };

  const handleDeleteSubcategory = async (
    provider: string,
    category: string,
    subcategory: string,
  ) => {
    const subItems = items.filter(
      (i) =>
        i.provider === provider &&
        i.category === category &&
        i.subcategory === subcategory,
    );
    if (
      !confirm(
        `Delete subcategory "${subcategory}" and its ${subItems.length} item${subItems.length !== 1 ? "s" : ""}?`,
      )
    )
      return;
    let failed = 0;
    for (const it of subItems) {
      const res = await window.api.mobileServiceItems.delete(it.id);
      if (!res.success) failed++;
    }
    if (failed > 0) setError(`${failed} items failed to delete`);
    await load();
  };

  const handleDeleteCategory = async (provider: string, category: string) => {
    const catItems = items.filter(
      (i) => i.provider === provider && i.category === category,
    );
    if (
      !confirm(
        `Delete category "${category}" and all ${catItems.length} item${catItems.length !== 1 ? "s" : ""}?`,
      )
    )
      return;
    let failed = 0;
    for (const it of catItems) {
      const res = await window.api.mobileServiceItems.delete(it.id);
      if (!res.success) failed++;
    }
    if (failed > 0) setError(`${failed} items failed to delete`);
    await load();
  };

  const handleAddItem = async () => {
    if (!newItemForm) return;
    setError("");
    if (
      !newItemForm.label.trim() ||
      !newItemForm.cost_lbp ||
      !newItemForm.sell_lbp
    ) {
      setError("Label, cost, and sell are required");
      return;
    }
    const costLbp = parseInt(newItemForm.cost_lbp, 10);
    const sellLbp = parseInt(newItemForm.sell_lbp, 10);
    if (isNaN(costLbp) || isNaN(sellLbp)) {
      setError("Cost and sell must be valid numbers");
      return;
    }
    try {
      const res = await window.api.mobileServiceItems.create({
        provider: newItemForm.provider,
        category: newItemForm.category,
        subcategory: newItemForm.subcategory,
        label: newItemForm.label.trim(),
        cost_lbp: costLbp,
        sell_lbp: sellLbp,
        sort_order: parseInt(newItemForm.sort_order, 10) || 0,
      });
      if (!res.success) {
        setError(res.error ?? "Failed to create item");
        return;
      }
      setNewItemForm(null);
      await load();
    } catch {
      setError("Create failed");
    }
  };

  const handleAddCategory = async () => {
    if (!newCategoryInput || !newCategoryInput.value.trim()) return;
    // Create a placeholder item so the category appears
    // User will then add subcategories and items
    setNewSubcategoryInput({
      provider: newCategoryInput.provider,
      category: newCategoryInput.value.trim(),
      value: "",
    });
    setNewCategoryInput(null);
  };

  const handleAddSubcategory = async () => {
    if (!newSubcategoryInput || !newSubcategoryInput.value.trim()) return;
    // Open new item form pre-filled with provider/category/subcategory
    setNewItemForm({
      ...EMPTY_NEW_ITEM,
      provider: newSubcategoryInput.provider,
      category: newSubcategoryInput.category,
      subcategory: newSubcategoryInput.value.trim(),
    });
    setNewSubcategoryInput(null);
  };

  // ── Counts ─────────────────────────────────────────────────────────
  const totalCount = items.length;
  const activeCount = items.filter((i) => i.is_active === 1).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        Loading mobile service items...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">
            Mobile Service Items
          </span>
          <span className="text-xs text-slate-500 ml-1">
            ({activeCount} active / {totalCount} total)
          </span>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
        >
          <option value="">All Providers</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2 flex items-center justify-between">
          {error}
          <button
            onClick={() => setError("")}
            className="text-red-400 hover:text-red-300"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── New item form (floating) ───────────────────────────────── */}
      {newItemForm && (
        <div className="border border-violet-600/40 rounded-lg p-4 bg-violet-950/20 space-y-3">
          <h4 className="text-white font-medium text-sm">
            New Item in{" "}
            <span className="text-violet-400">
              {newItemForm.provider} / {newItemForm.category} /{" "}
              {newItemForm.subcategory}
            </span>
          </h4>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-slate-400 text-xs block mb-1">Label</label>
              <input
                autoFocus
                type="text"
                value={newItemForm.label}
                onChange={(e) =>
                  setNewItemForm({ ...newItemForm, label: e.target.value })
                }
                placeholder="e.g. 60UC, 3.6"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="w-32">
              <label className="text-slate-400 text-xs block mb-1">
                Cost (LBP)
              </label>
              <input
                type="number"
                value={newItemForm.cost_lbp}
                onChange={(e) =>
                  setNewItemForm({ ...newItemForm, cost_lbp: e.target.value })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="w-32">
              <label className="text-slate-400 text-xs block mb-1">
                Sell (LBP)
              </label>
              <input
                type="number"
                value={newItemForm.sell_lbp}
                onChange={(e) =>
                  setNewItemForm({ ...newItemForm, sell_lbp: e.target.value })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="w-20">
              <label className="text-slate-400 text-xs block mb-1">Order</label>
              <input
                type="number"
                value={newItemForm.sort_order}
                onChange={(e) =>
                  setNewItemForm({ ...newItemForm, sort_order: e.target.value })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
            <button
              onClick={handleAddItem}
              className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded text-sm font-medium transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => setNewItemForm(null)}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Provider groups ────────────────────────────────────────── */}
      <div className="space-y-4">
        {grouped.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            No mobile service items found.
          </div>
        )}

        {grouped.map((provGroup) => {
          const colors = PROVIDER_COLORS[provGroup.provider] ?? {
            bg: "bg-slate-600/10",
            text: "text-slate-400",
            border: "border-slate-600/30",
          };

          return (
            <div
              key={provGroup.provider}
              className={`rounded-xl border ${colors.border} overflow-hidden`}
            >
              {/* Provider header */}
              <div
                className={`${colors.bg} px-4 py-3 flex items-center justify-between cursor-pointer hover:brightness-110 transition-all`}
                onClick={() => toggleProvider(provGroup.provider)}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    size={16}
                    className={`${colors.text} transition-transform ${
                      collapsedProviders.has(provGroup.provider)
                        ? "-rotate-90"
                        : ""
                    }`}
                  />
                  <span
                    className={`text-sm font-bold ${colors.text} uppercase tracking-wider`}
                  >
                    {provGroup.provider}
                  </span>
                </div>
                <div
                  className="flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-slate-500">
                    {provGroup.categories.reduce(
                      (sum, c) =>
                        sum +
                        c.subcategories.reduce(
                          (s, sc) => s + sc.items.length,
                          0,
                        ),
                      0,
                    )}{" "}
                    items
                  </span>
                  {/* Add Category */}
                  {newCategoryInput?.provider === provGroup.provider ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="text"
                        value={newCategoryInput.value}
                        onChange={(e) =>
                          setNewCategoryInput({
                            ...newCategoryInput,
                            value: e.target.value,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddCategory();
                          if (e.key === "Escape") setNewCategoryInput(null);
                        }}
                        placeholder="New category name..."
                        className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-xs w-40 focus:outline-none focus:border-violet-500"
                      />
                      <button
                        onClick={handleAddCategory}
                        className="text-emerald-400 hover:text-emerald-300 p-1"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setNewCategoryInput(null)}
                        className="text-slate-500 hover:text-slate-300 p-1"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() =>
                        setNewCategoryInput({
                          provider: provGroup.provider,
                          value: "",
                        })
                      }
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-slate-700/50"
                      title="Add category"
                    >
                      <FolderPlus size={13} />
                      <span>Category</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Categories */}
              {!collapsedProviders.has(provGroup.provider) && (
                <div className="divide-y divide-slate-800/50">
                  {provGroup.categories.map((cat) => {
                    const catKey = `${provGroup.provider}|${cat.name}`;
                    const isCatCollapsed = collapsedCategories.has(catKey);

                    return (
                      <div key={catKey}>
                        {/* Category header */}
                        <div
                          className="flex items-center justify-between px-4 py-2.5 bg-slate-800/40 cursor-pointer hover:bg-slate-800/60 transition-colors"
                          onClick={() => toggleCategory(catKey)}
                        >
                          <div className="flex items-center gap-2">
                            <ChevronDown
                              size={14}
                              className={`text-slate-400 transition-transform ${
                                isCatCollapsed ? "-rotate-90" : ""
                              }`}
                            />
                            <span className="text-sm font-semibold text-slate-200">
                              {cat.name}
                            </span>
                            <span className="text-xs text-slate-500">
                              (
                              {cat.subcategories.reduce(
                                (s, sc) => s + sc.items.length,
                                0,
                              )}{" "}
                              items)
                            </span>
                          </div>
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Add Subcategory */}
                            {newSubcategoryInput?.provider ===
                              provGroup.provider &&
                            newSubcategoryInput?.category === cat.name ? (
                              <div className="flex items-center gap-1">
                                <input
                                  autoFocus
                                  type="text"
                                  value={newSubcategoryInput.value}
                                  onChange={(e) =>
                                    setNewSubcategoryInput({
                                      ...newSubcategoryInput,
                                      value: e.target.value,
                                    })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      handleAddSubcategory();
                                    if (e.key === "Escape")
                                      setNewSubcategoryInput(null);
                                  }}
                                  placeholder="New subcategory..."
                                  className="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs w-36 focus:outline-none focus:border-violet-500"
                                />
                                <button
                                  onClick={handleAddSubcategory}
                                  className="text-emerald-400 hover:text-emerald-300 p-1"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  onClick={() => setNewSubcategoryInput(null)}
                                  className="text-slate-500 hover:text-slate-300 p-1"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() =>
                                  setNewSubcategoryInput({
                                    provider: provGroup.provider,
                                    category: cat.name,
                                    value: "",
                                  })
                                }
                                className="text-slate-500 hover:text-slate-300 p-1 transition-colors"
                                title="Add subcategory"
                              >
                                <FolderPlus size={13} />
                              </button>
                            )}
                            <button
                              onClick={() =>
                                handleDeleteCategory(
                                  provGroup.provider,
                                  cat.name,
                                )
                              }
                              className="text-slate-600 hover:text-red-400 p-1 transition-colors"
                              title="Delete category"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Subcategories (indented) */}
                        {!isCatCollapsed && (
                          <div>
                            {cat.subcategories.map((sub) => {
                              const subKey = `${catKey}|${sub.name}`;
                              const isSubCollapsed =
                                collapsedSubcategories.has(subKey);

                              return (
                                <div key={subKey} className="pl-6">
                                  {/* Subcategory header */}
                                  <div
                                    className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-800/30 transition-colors"
                                    onClick={() => toggleSubcategory(subKey)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <ChevronDown
                                        size={12}
                                        className={`text-slate-500 transition-transform ${
                                          isSubCollapsed ? "-rotate-90" : ""
                                        }`}
                                      />
                                      <span className="text-xs font-medium text-slate-300">
                                        {sub.name}
                                      </span>
                                      <span className="text-xs text-slate-600">
                                        ({sub.items.length})
                                      </span>
                                    </div>
                                    <div
                                      className="flex items-center gap-1"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {/* Add item to this subcategory */}
                                      <button
                                        onClick={() =>
                                          setNewItemForm({
                                            ...EMPTY_NEW_ITEM,
                                            provider: provGroup.provider,
                                            category: cat.name,
                                            subcategory: sub.name,
                                          })
                                        }
                                        className="text-slate-600 hover:text-emerald-400 p-1 transition-colors"
                                        title="Add item"
                                      >
                                        <Plus size={13} />
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleDeleteSubcategory(
                                            provGroup.provider,
                                            cat.name,
                                            sub.name,
                                          )
                                        }
                                        className="text-slate-600 hover:text-red-400 p-1 transition-colors"
                                        title="Delete subcategory"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Items (rows) */}
                                  {!isSubCollapsed && (
                                    <div className="pl-5 pb-2 space-y-px">
                                      {sub.items.map((item) => {
                                        const isEditing =
                                          editing?.id === item.id;
                                        const profit =
                                          item.sell_lbp - item.cost_lbp;

                                        if (isEditing && editing) {
                                          // ── Inline edit row ──
                                          return (
                                            <div
                                              key={item.id}
                                              className="flex items-center gap-2 px-3 py-1.5 bg-violet-950/20 rounded border border-violet-600/30"
                                            >
                                              <input
                                                autoFocus
                                                type="text"
                                                value={editing.label}
                                                onChange={(e) =>
                                                  setEditing({
                                                    ...editing,
                                                    label: e.target.value,
                                                  })
                                                }
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter")
                                                    handleSaveEdit();
                                                  if (e.key === "Escape")
                                                    setEditing(null);
                                                }}
                                                className="w-28 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-violet-500"
                                              />
                                              <div className="flex items-center gap-1">
                                                <span className="text-xs text-slate-500">
                                                  C:
                                                </span>
                                                <input
                                                  type="number"
                                                  value={editing.cost_lbp}
                                                  onChange={(e) =>
                                                    setEditing({
                                                      ...editing,
                                                      cost_lbp: e.target.value,
                                                    })
                                                  }
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter")
                                                      handleSaveEdit();
                                                    if (e.key === "Escape")
                                                      setEditing(null);
                                                  }}
                                                  className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-violet-500"
                                                />
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <span className="text-xs text-slate-500">
                                                  S:
                                                </span>
                                                <input
                                                  type="number"
                                                  value={editing.sell_lbp}
                                                  onChange={(e) =>
                                                    setEditing({
                                                      ...editing,
                                                      sell_lbp: e.target.value,
                                                    })
                                                  }
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter")
                                                      handleSaveEdit();
                                                    if (e.key === "Escape")
                                                      setEditing(null);
                                                  }}
                                                  className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-violet-500"
                                                />
                                              </div>
                                              <button
                                                onClick={handleSaveEdit}
                                                className="text-emerald-400 hover:text-emerald-300 p-1 transition-colors"
                                              >
                                                <Check size={13} />
                                              </button>
                                              <button
                                                onClick={() => setEditing(null)}
                                                className="text-slate-500 hover:text-slate-300 p-1 transition-colors"
                                              >
                                                <X size={13} />
                                              </button>
                                            </div>
                                          );
                                        }

                                        // ── Normal display row ──
                                        return (
                                          <div
                                            key={item.id}
                                            className={`flex items-center justify-between px-3 py-1.5 rounded group transition-colors ${
                                              item.is_active === 0
                                                ? "opacity-40"
                                                : "hover:bg-slate-800/40"
                                            }`}
                                          >
                                            <div className="flex items-center gap-4 min-w-0">
                                              <span className="text-sm text-white font-medium w-28 truncate">
                                                {item.label}
                                              </span>
                                              <span className="text-xs text-slate-400 font-mono">
                                                C:{" "}
                                                {item.cost_lbp.toLocaleString()}
                                              </span>
                                              <span className="text-xs text-slate-300 font-mono">
                                                S:{" "}
                                                {item.sell_lbp.toLocaleString()}
                                              </span>
                                              <span
                                                className={`text-xs font-mono ${
                                                  profit > 0
                                                    ? "text-emerald-400"
                                                    : profit < 0
                                                      ? "text-red-400"
                                                      : "text-slate-600"
                                                }`}
                                              >
                                                P: {profit.toLocaleString()}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                              <button
                                                onClick={() =>
                                                  handleToggleActive(item)
                                                }
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                  item.is_active
                                                    ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                                                    : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                                                }`}
                                              >
                                                {item.is_active ? "ON" : "OFF"}
                                              </button>
                                              <button
                                                onClick={() =>
                                                  setEditing({
                                                    id: item.id,
                                                    label: item.label,
                                                    cost_lbp:
                                                      item.cost_lbp.toString(),
                                                    sell_lbp:
                                                      item.sell_lbp.toString(),
                                                    sort_order:
                                                      item.sort_order.toString(),
                                                  })
                                                }
                                                className="text-slate-500 hover:text-blue-400 p-1 transition-colors"
                                                title="Edit"
                                              >
                                                <Pencil size={12} />
                                              </button>
                                              <button
                                                onClick={() =>
                                                  handleDelete(item)
                                                }
                                                className="text-slate-500 hover:text-red-400 p-1 transition-colors"
                                                title="Delete"
                                              >
                                                <Trash2 size={12} />
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-500 italic">
        Inactive items are dimmed and hidden from the card grid. Changes take
        effect immediately.
      </p>
    </div>
  );
}
