/**
 * Mobile Services Manager
 *
 * Settings tab — CRUD for mobile service catalog items.
 * Hierarchical collapsible view: Provider → Category → Subcategory → Items
 * Each item is an inline-editable row with cost/sell/label/split fields.
 *
 * LIRA-090: adds per-item Only-Days split editor (days_cost_lbp,
 * sell_days_lbp, sell_credit_lbp) and the §2.4 decision-aid table
 * showing the delivered-credit cost for 1$/2$/3$ SMS chunks.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
  ChevronDown,
  FolderPlus,
} from "lucide-react";
import type { MobileServiceItem } from "@/types/electron";
import { DecimalInput, Select, useApi } from "@liratek/ui";
import { parseCatalogToSeedData } from "@/features/recharge/utils/parseCatalogToSeedData";
import {
  isTelecomSplitComplete,
  deriveItemEconomics,
  deliveredCostLbp,
  DEFAULT_TELECOM_CREDIT_SELL_PRICE_LBP,
} from "@liratek/core";

/** Tenant setting key for the resale table's reference sell price (LBP per
 *  $1 of resold credit). Seeded per-tenant by migration v141/`TenantRepository`;
 *  read here for the first time (TELECOM_DAYS_COST_PLAN.md §10 Q5). */
const TELECOM_CREDIT_SELL_PRICE_SETTING_KEY = "telecom_credit_sell_price_lbp";

const PROVIDERS = [
  "iPick",
  "Katsh",
  "WHISH_APP",
  "OMT_APP",
  "VOUCHER",
] as const;

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
  WHISH_APP: {
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
  /** Structured validity (days) / credits — LIRA W6.b. Empty string = null. */
  validity_days: string;
  credits: string;
  /** LIRA-090 Only-Days split. Empty string = null (not yet configured). */
  days_cost_lbp: string;
  sell_days_lbp: string;
  sell_credit_lbp: string;
}

interface NewItemForm {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: string;
  sell_lbp: string;
  sort_order: string;
  validity_days: string;
  credits: string;
  /** LIRA-090 Only-Days split. Empty string = null (not yet configured). */
  days_cost_lbp: string;
  sell_days_lbp: string;
  sell_credit_lbp: string;
}

const EMPTY_NEW_ITEM: NewItemForm = {
  provider: "",
  category: "",
  subcategory: "",
  label: "",
  cost_lbp: "",
  sell_lbp: "",
  sort_order: "0",
  validity_days: "",
  credits: "",
  days_cost_lbp: "",
  sell_days_lbp: "",
  sell_credit_lbp: "",
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
  const api = useApi();
  const [items, setItems] = useState<MobileServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Resale table reference price, level 2 of the 3-level fallback (item ->
  // tenant setting -> DEFAULT_TELECOM_CREDIT_SELL_PRICE_LBP). Null until
  // loaded or when the tenant hasn't set a positive value.
  const [tenantSellPriceLbp, setTenantSellPriceLbp] = useState<number | null>(
    null,
  );

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
  // Seeding + the admin list read: seeding stays IPC-only (window.api) — a
  // pre-existing gap in this feature's dual-transport coverage, not
  // introduced here (see the W6 report). The list + update paths below ARE
  // dual-transport (LIRA W6.b) since this ticket touches them directly.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const countRes = await window.api.mobileServiceItems.count();
      if (countRes.success && countRes.data === 0) {
        const seedData = parseCatalogToSeedData();
        await window.api.mobileServiceItems.seed(seedData);
      }
      const data = await api.getAdminMobileServiceItems();
      setItems(data as unknown as MobileServiceItem[]);
    } catch {
      setError("Failed to load mobile service items");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // Resale table reference price — dual-transport (rule 19) via
  // api.getAllSettings(), same pattern TelecomForm.tsx uses for
  // alfa_credit_cost_lbp. Best-effort: any failure just leaves the
  // fallback chain at its next level.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await api.getAllSettings();
        const row = (
          settings as Array<{ key_name: string; value: string }>
        ).find((s) => s.key_name === TELECOM_CREDIT_SELL_PRICE_SETTING_KEY);
        const value = row ? Number(row.value) : NaN;
        if (!cancelled && Number.isFinite(value) && value > 0) {
          setTenantSellPriceLbp(value);
        }
      } catch {
        // Best-effort — the fallback chain covers this.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

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
    const daysCostLbp =
      editing.days_cost_lbp.trim() === ""
        ? null
        : parseInt(editing.days_cost_lbp, 10);
    const sellDaysLbp =
      editing.sell_days_lbp.trim() === ""
        ? null
        : parseInt(editing.sell_days_lbp, 10);
    const sellCreditLbp =
      editing.sell_credit_lbp.trim() === ""
        ? null
        : parseInt(editing.sell_credit_lbp, 10);
    try {
      const res = await api.updateMobileServiceItem(editing.id, {
        label: editing.label.trim(),
        cost_lbp: costLbp,
        sell_lbp: sellLbp,
        sort_order: parseInt(editing.sort_order, 10) || 0,
        validity_days:
          editing.validity_days.trim() === ""
            ? null
            : parseInt(editing.validity_days, 10),
        credits:
          editing.credits.trim() === "" ? null : parseFloat(editing.credits),
        days_cost_lbp: daysCostLbp,
        sell_days_lbp: sellDaysLbp,
        sell_credit_lbp: sellCreditLbp,
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
    const daysCostLbp =
      newItemForm.days_cost_lbp.trim() === ""
        ? null
        : parseInt(newItemForm.days_cost_lbp, 10);
    const sellDaysLbp =
      newItemForm.sell_days_lbp.trim() === ""
        ? null
        : parseInt(newItemForm.sell_days_lbp, 10);
    const sellCreditLbp =
      newItemForm.sell_credit_lbp.trim() === ""
        ? null
        : parseInt(newItemForm.sell_credit_lbp, 10);
    try {
      const res = await api.createMobileServiceItem({
        provider: newItemForm.provider,
        category: newItemForm.category,
        subcategory: newItemForm.subcategory,
        label: newItemForm.label.trim(),
        cost_lbp: costLbp,
        sell_lbp: sellLbp,
        sort_order: parseInt(newItemForm.sort_order, 10) || 0,
        validity_days:
          newItemForm.validity_days.trim() === ""
            ? null
            : parseInt(newItemForm.validity_days, 10),
        credits:
          newItemForm.credits.trim() === ""
            ? null
            : parseFloat(newItemForm.credits),
        days_cost_lbp: daysCostLbp,
        sell_days_lbp: sellDaysLbp,
        sell_credit_lbp: sellCreditLbp,
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
        <Select
          value={providerFilter}
          onChange={(v) => setProviderFilter(v)}
          options={[
            { value: "", label: "All Providers" },
            ...PROVIDERS.map((p) => ({ value: p, label: p })),
          ]}
          buttonClassName="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
        />

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
              <DecimalInput
                value={parseFloat(newItemForm.cost_lbp) || 0}
                onChange={(n) =>
                  setNewItemForm({
                    ...newItemForm,
                    cost_lbp: n ? String(n) : "",
                  })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="w-32">
              <label className="text-slate-400 text-xs block mb-1">
                Sell (LBP)
              </label>
              <DecimalInput
                value={parseFloat(newItemForm.sell_lbp) || 0}
                onChange={(n) =>
                  setNewItemForm({
                    ...newItemForm,
                    sell_lbp: n ? String(n) : "",
                  })
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
            <div className="w-24">
              <label className="text-slate-400 text-xs block mb-1">
                Validity (d)
              </label>
              <input
                type="number"
                min="0"
                value={newItemForm.validity_days}
                onChange={(e) =>
                  setNewItemForm({
                    ...newItemForm,
                    validity_days: e.target.value,
                  })
                }
                placeholder="—"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="w-24">
              <label className="text-slate-400 text-xs block mb-1">
                Credits ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newItemForm.credits}
                onChange={(e) =>
                  setNewItemForm({ ...newItemForm, credits: e.target.value })
                }
                placeholder="—"
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
                                          const editSplitComplete =
                                            isTelecomSplitComplete({
                                              cost_lbp:
                                                parseFloat(editing.cost_lbp) ||
                                                null,
                                              days_cost_lbp:
                                                editing.days_cost_lbp.trim() ===
                                                ""
                                                  ? null
                                                  : parseFloat(
                                                      editing.days_cost_lbp,
                                                    ),
                                              credits:
                                                editing.credits.trim() === ""
                                                  ? null
                                                  : parseFloat(editing.credits),
                                            });
                                          return (
                                            <div
                                              key={item.id}
                                              className="flex flex-col gap-1 px-3 py-2 bg-violet-950/20 rounded border border-violet-600/30"
                                            >
                                              {/* Row 1: label + base cost/sell/order/validity/credits */}
                                              <div className="flex items-center gap-2 flex-wrap">
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
                                                  <DecimalInput
                                                    value={
                                                      parseFloat(
                                                        editing.cost_lbp,
                                                      ) || 0
                                                    }
                                                    onChange={(n) =>
                                                      setEditing({
                                                        ...editing,
                                                        cost_lbp: n
                                                          ? String(n)
                                                          : "",
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
                                                  <DecimalInput
                                                    value={
                                                      parseFloat(
                                                        editing.sell_lbp,
                                                      ) || 0
                                                    }
                                                    onChange={(n) =>
                                                      setEditing({
                                                        ...editing,
                                                        sell_lbp: n
                                                          ? String(n)
                                                          : "",
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
                                                    Val(d):
                                                  </span>
                                                  <input
                                                    type="number"
                                                    min="0"
                                                    value={editing.validity_days}
                                                    onChange={(e) =>
                                                      setEditing({
                                                        ...editing,
                                                        validity_days:
                                                          e.target.value,
                                                      })
                                                    }
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter")
                                                        handleSaveEdit();
                                                      if (e.key === "Escape")
                                                        setEditing(null);
                                                    }}
                                                    placeholder="—"
                                                    className="w-14 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-violet-500"
                                                  />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-xs text-slate-500">
                                                    Cred($):
                                                  </span>
                                                  <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={editing.credits}
                                                    onChange={(e) =>
                                                      setEditing({
                                                        ...editing,
                                                        credits: e.target.value,
                                                      })
                                                    }
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter")
                                                        handleSaveEdit();
                                                      if (e.key === "Escape")
                                                        setEditing(null);
                                                    }}
                                                    placeholder="—"
                                                    className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-violet-500"
                                                  />
                                                </div>
                                                <button
                                                  onClick={handleSaveEdit}
                                                  aria-label="Save item"
                                                  className="text-emerald-400 hover:text-emerald-300 p-1 transition-colors"
                                                >
                                                  <Check size={13} />
                                                </button>
                                                <button
                                                  onClick={() =>
                                                    setEditing(null)
                                                  }
                                                  aria-label="Cancel edit"
                                                  className="text-slate-500 hover:text-slate-300 p-1 transition-colors"
                                                >
                                                  <X size={13} />
                                                </button>
                                              </div>
                                              {/* Row 2: Only-Days split fields */}
                                              <div className="flex items-center gap-2 flex-wrap border-t border-violet-800/30 pt-1.5 mt-0.5">
                                                <span className="text-[10px] text-violet-400 font-medium">
                                                  Only-Days split:
                                                </span>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-[10px] text-slate-500">
                                                    Days cost:
                                                  </span>
                                                  <DecimalInput
                                                    value={
                                                      parseFloat(
                                                        editing.days_cost_lbp,
                                                      ) || 0
                                                    }
                                                    onChange={(n) =>
                                                      setEditing({
                                                        ...editing,
                                                        days_cost_lbp: n
                                                          ? String(n)
                                                          : "",
                                                      })
                                                    }
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter")
                                                        handleSaveEdit();
                                                      if (e.key === "Escape")
                                                        setEditing(null);
                                                    }}
                                                    placeholder="—"
                                                    className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-violet-500"
                                                  />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-[10px] text-slate-500">
                                                    Sell days:
                                                  </span>
                                                  <DecimalInput
                                                    value={
                                                      parseFloat(
                                                        editing.sell_days_lbp,
                                                      ) || 0
                                                    }
                                                    onChange={(n) =>
                                                      setEditing({
                                                        ...editing,
                                                        sell_days_lbp: n
                                                          ? String(n)
                                                          : "",
                                                      })
                                                    }
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter")
                                                        handleSaveEdit();
                                                      if (e.key === "Escape")
                                                        setEditing(null);
                                                    }}
                                                    placeholder="—"
                                                    className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-violet-500"
                                                  />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-[10px] text-slate-500">
                                                    Sell credit:
                                                  </span>
                                                  <DecimalInput
                                                    value={
                                                      parseFloat(
                                                        editing.sell_credit_lbp,
                                                      ) || 0
                                                    }
                                                    onChange={(n) =>
                                                      setEditing({
                                                        ...editing,
                                                        sell_credit_lbp: n
                                                          ? String(n)
                                                          : "",
                                                      })
                                                    }
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter")
                                                        handleSaveEdit();
                                                      if (e.key === "Escape")
                                                        setEditing(null);
                                                    }}
                                                    placeholder="—"
                                                    className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-violet-500"
                                                  />
                                                </div>
                                                <span
                                                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                    editSplitComplete
                                                      ? "bg-emerald-600/20 text-emerald-400"
                                                      : "bg-slate-700/50 text-slate-500"
                                                  }`}
                                                >
                                                  {editSplitComplete
                                                    ? "Enabled"
                                                    : "Incomplete"}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        }

                                        // ── Normal display row ──
                                        const splitComplete =
                                          isTelecomSplitComplete({
                                            cost_lbp: item.cost_lbp,
                                            days_cost_lbp: item.days_cost_lbp,
                                            credits: item.credits,
                                          });
                                        const economics = splitComplete
                                          ? deriveItemEconomics({
                                              costLbp: item.cost_lbp,
                                              daysCostLbp: item.days_cost_lbp,
                                              creditsUsd: item.credits,
                                            })
                                          : null;
                                        // sell_credit_lbp is the reference price for profit calc.
                                        // 3-level fallback (TELECOM_DAYS_COST_PLAN.md §10 Q5):
                                        // per-item price -> the tenant's telecom_credit_sell_price_lbp
                                        // setting -> the named default (spec §2.4).
                                        const sellCreditRef =
                                          item.sell_credit_lbp ??
                                          tenantSellPriceLbp ??
                                          DEFAULT_TELECOM_CREDIT_SELL_PRICE_LBP;

                                        return (
                                          <div
                                            key={item.id}
                                            className={`flex flex-col px-3 py-1.5 rounded group transition-colors ${
                                              item.is_active === 0
                                                ? "opacity-40"
                                                : "hover:bg-slate-800/40"
                                            }`}
                                          >
                                            {/* Main display row */}
                                            <div className="flex items-center justify-between min-w-0">
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
                                                {item.validity_days != null && (
                                                  <span className="text-[10px] text-slate-500">
                                                    {item.validity_days}d
                                                  </span>
                                                )}
                                                {item.credits != null && (
                                                  <span className="text-[10px] text-slate-500">
                                                    ${item.credits} credit
                                                  </span>
                                                )}
                                                {/* Split status badge */}
                                                <span
                                                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                    splitComplete
                                                      ? "bg-emerald-600/20 text-emerald-400"
                                                      : "bg-slate-700/40 text-slate-500"
                                                  }`}
                                                >
                                                  {splitComplete
                                                    ? "Split"
                                                    : "No split"}
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
                                                  {item.is_active
                                                    ? "ON"
                                                    : "OFF"}
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
                                                      validity_days:
                                                        item.validity_days !=
                                                        null
                                                          ? String(
                                                              item.validity_days,
                                                            )
                                                          : "",
                                                      credits:
                                                        item.credits != null
                                                          ? String(item.credits)
                                                          : "",
                                                      days_cost_lbp:
                                                        item.days_cost_lbp !=
                                                        null
                                                          ? String(
                                                              item.days_cost_lbp,
                                                            )
                                                          : "",
                                                      sell_days_lbp:
                                                        item.sell_days_lbp !=
                                                        null
                                                          ? String(
                                                              item.sell_days_lbp,
                                                            )
                                                          : "",
                                                      sell_credit_lbp:
                                                        item.sell_credit_lbp !=
                                                        null
                                                          ? String(
                                                              item.sell_credit_lbp,
                                                            )
                                                          : "",
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
                                            {/* §2.4 decision-aid table — visible only when split is complete */}
                                            {splitComplete &&
                                              economics?.recoveredRateLbp !=
                                                null && (
                                                <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                  <p className="text-[10px] text-slate-500 mb-0.5">
                                                    Credit resale cost (per $1
                                                    delivered):
                                                  </p>
                                                  <div className="flex gap-2">
                                                    {(
                                                      [1, 2, 3] as const
                                                    ).map((chunk) => {
                                                      const cost =
                                                        deliveredCostLbp(
                                                          economics.recoveredRateLbp!,
                                                          chunk,
                                                        );
                                                      if (cost == null)
                                                        return null;
                                                      const costRounded =
                                                        Math.round(cost);
                                                      const profitVal =
                                                        sellCreditRef -
                                                        costRounded;
                                                      // Break-even: round UP to the nearest 1,000 LBP
                                                      // so a price actually charged at this figure can
                                                      // never fall short of the true delivered cost.
                                                      // Actionable regardless of whether sellCreditRef
                                                      // (the reference above) is stale — a table that
                                                      // is red end-to-end at least tells the operator
                                                      // what to charge instead.
                                                      const breakEvenLbp =
                                                        Math.ceil(
                                                          costRounded / 1_000,
                                                        ) * 1_000;
                                                      return (
                                                        <span
                                                          key={chunk}
                                                          title={`${chunk}$/SMS`}
                                                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                                            profitVal < 0
                                                              ? "bg-red-900/30 text-red-400"
                                                              : "bg-slate-800/60 text-slate-300"
                                                          }`}
                                                        >
                                                          {chunk}$:{" "}
                                                          {costRounded.toLocaleString()}{" "}
                                                          (
                                                          <span
                                                            className={
                                                              profitVal < 0
                                                                ? "text-red-400"
                                                                : "text-emerald-400"
                                                            }
                                                          >
                                                            {profitVal >= 0
                                                              ? "+"
                                                              : ""}
                                                            {profitVal.toLocaleString()}
                                                          </span>
                                                          ){" "}
                                                          <span className="text-slate-500">
                                                            · charge ≥{" "}
                                                            {breakEvenLbp.toLocaleString()}
                                                          </span>
                                                        </span>
                                                      );
                                                    })}
                                                  </div>
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
