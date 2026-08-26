import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import logger from "@/utils/logger";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  Plus,
  Search,
  Package,
  Edit2,
  Trash2,
  Upload,
  X,
  Layers,
  PackagePlus,
  Smartphone,
} from "lucide-react";
import { PageHeader, useApi, appEvents } from "@liratek/ui";
import ProductForm from "./ProductForm";
import type { Product } from "@liratek/ui";
import {
  DataTable,
  ConfirmModal,
  MultiSelect,
  DateRangeFilter,
} from "@liratek/ui";
import AdjustStockModal from "../../components/AdjustStockModal";
import { ImeiStoryCard } from "../../components/ImeiStoryCard";
import { InventoryFiltersPopover } from "../../components/InventoryFiltersPopover";
import { useUnitStoryQuery } from "../../hooks/useProductUnits";
import {
  buildUnitDeleteWarning,
  looksLikeImei,
  type UnitDeleteEntry,
} from "../../productUnitsLogic";
import {
  EMPTY_PRODUCT_FILTERS,
  activeFilterChips,
  buildProductListFilters,
  clearFilterGroup,
  clearNumericFilters,
  countNumericFilters,
  type NumericFilterField,
  type ProductFilterChipKey,
  type ProductFiltersUiState,
} from "../../productListFilters";

interface BatchUpdateFields {
  category?: string;
  min_stock_level?: string; // string for input, parsed on submit
  supplier?: string;
  unit?: string;
}

/** Shape of one record in a .toon import file */
interface ToonRecord {
  category?: string;
  name?: string;
  code?: string; // barcode
  price?: number; // retail price
  cost?: number;
  supplier?: string;
  unit?: string;
  stockQuantity?: number;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    // Handle backslash-escaped quote (\") inside quoted fields
    if (inQuotes && char === "\\" && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function toOptionalValue(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "null") return undefined;
  return normalized;
}

/** Result of a single import attempt */
interface ImportResult {
  name: string;
  success: boolean;
  error?: string;
}

/**
 * Parse a .toon file with this format:
 *   items[COUNT,]{category,name,code,price,cost,supplier}:
 *   category,name,barcode,price,cost,supplier
 *   ...
 *
 * The header line is skipped. Each subsequent CSV line is parsed.
 */
function parseToonFile(text: string): ToonRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const records: ToonRecord[] = [];
  let inData = false;

  for (const line of lines) {
    // Header line — detect by TOON table header
    if (line.startsWith("items[")) {
      inData = true;
      continue;
    }
    if (!inData) {
      inData = true; // treat first non-header line as data
    }
    const parts = parseCsvLine(line);
    if (parts.length < 2) continue;
    const [
      categoryRaw,
      nameRaw,
      codeRaw,
      priceRaw,
      costRaw,
      supplierRaw,
      unitRaw,
    ] = parts;

    const category = toOptionalValue(categoryRaw);
    const name = toOptionalValue(nameRaw);
    const code = toOptionalValue(codeRaw);
    const supplier = toOptionalValue(supplierRaw);
    const unitValue = toOptionalValue(unitRaw);

    const parsedPrice = toOptionalValue(priceRaw);
    const parsedCost = toOptionalValue(costRaw);
    const unitAsNumber = unitValue ? Number(unitValue) : NaN;

    const record: ToonRecord = {
      stockQuantity: Number.isFinite(unitAsNumber) ? unitAsNumber : 0,
    };
    if (category) record.category = category;
    if (name) record.name = name;
    if (code) record.code = code;
    if (parsedPrice) record.price = parseFloat(parsedPrice);
    if (parsedCost) record.cost = parseFloat(parsedCost);
    if (supplier) record.supplier = supplier;
    if (!Number.isFinite(unitAsNumber) && unitValue) record.unit = unitValue;
    records.push(record);
  }
  return records;
}

export default function ProductList() {
  const api = useApi();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  /** All product-list filters. The BACKEND applies them (SQL), so `products`
   *  already arrives filtered — nothing below re-filters it client-side. */
  const [filters, setFilters] = useState<ProductFiltersUiState>(
    EMPTY_PRODUCT_FILTERS,
  );
  const [filterOptions, setFilterOptions] = useState<{
    categories: string[];
    suppliers: string[];
  }>({ categories: [], suppliers: [] });
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Minimized product forms
  type MinimizedProduct = {
    id: string;
    formData: {
      barcode: string;
      name: string;
      category: string;
      cost_price: number;
      retail_price: number;
      min_stock_level: number;
      stock_quantity: number;
      supplier: string;
    };
    editingProduct: Product | null;
    createdAt: string;
  };
  const [minimizedProducts, setMinimizedProducts] = useState<
    MinimizedProduct[]
  >(() => {
    try {
      const stored = localStorage.getItem("products_minimized_forms");
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      logger.error("Failed to load minimized products:", error);
    }
    return [];
  });

  // ── Batch selection ───────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  /** Tracks the current visible (sorted+paginated) product order from DataTable */
  const visibleProductsRef = useRef<Product[]>([]);
  /** IDs added by the last shift-select range — replaced on next shift-select */
  const lastShiftRangeRef = useRef<Set<number>>(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchFields, setBatchFields] = useState<BatchUpdateFields>({});
  const [batchSaving, setBatchSaving] = useState(false);

  // Confirmation states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{
    id: number;
  } | null>(null);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  /**
   * LIRA-143 item #7 — the extra paragraph the delete confirm shows when the
   * product(s) being deleted still hold registered IN_STOCK units. The delete
   * cascade removes those `product_units` rows too, so the dialog names the
   * count and the actual IMEIs first. `null` = nothing to disclose, and the
   * dialog reads exactly as it always did.
   *
   * State, not a computed value: the IMEIs come from an IPC/REST read fired
   * when the operator asks to delete, so the dialog opens immediately (with
   * "Checking…") and gains the disclosure a moment later. It is NOT a gate —
   * a failed check is disclosed as a failed check (see
   * `buildUnitDeleteWarning`'s `probeFailed`), never as "no units".
   */
  const [deleteUnitWarning, setDeleteUnitWarning] = useState<string | null>(
    null,
  );
  const [checkingUnits, setCheckingUnits] = useState(false);

  const allSelected =
    products.length > 0 && selectedIds.size === products.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /**
   * Called by DataTable when the user Shift+clicks a row.
   * `fromIndex` and `toIndex` are inclusive visible-row indices (already
   * sorted ascending by DataTable). We add all IDs in that range to the
   * current selection (we never deselect with shift — only extend).
   */
  const handleShiftSelect = useCallback(
    (fromIndex: number, toIndex: number) => {
      const newRange = new Set(
        visibleProductsRef.current
          .slice(fromIndex, toIndex + 1)
          .map((p) => p.id),
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        // Remove IDs that were part of the previous shift-range but are
        // no longer in the new range
        lastShiftRangeRef.current.forEach((id) => {
          if (!newRange.has(id)) next.delete(id);
        });
        // Add all IDs in the new range
        newRange.forEach((id) => next.add(id));
        return next;
      });
      lastShiftRangeRef.current = newRange;
    },
    [],
  );

  const handleBatchSave = async () => {
    if (selectedIds.size === 0) return;
    setBatchSaving(true);
    try {
      const payload: Record<string, unknown> = { ids: [...selectedIds] };
      if (batchFields.category !== undefined && batchFields.category !== "")
        payload.category = batchFields.category;
      if (
        batchFields.min_stock_level !== undefined &&
        batchFields.min_stock_level !== ""
      )
        payload.min_stock_level = parseInt(batchFields.min_stock_level);
      if (batchFields.supplier !== undefined && batchFields.supplier !== "")
        payload.supplier = batchFields.supplier;
      if (batchFields.unit !== undefined && batchFields.unit !== "")
        payload.unit = batchFields.unit;

      const result = window.api
        ? await (window.api as any).inventory.batchUpdate(payload)
        : await (api as any).batchUpdateProducts?.(payload);

      if (result?.success) {
        setShowBatchModal(false);
        setBatchFields({});
        setSelectedIds(new Set());
        loadProducts();
        loadFilterOptions();
        appEvents.emit(
          "notification:show",
          "Batch update successful",
          "success",
        );
        // Windows focus fix
        window.api?.display?.fixFocus();
      } else {
        appEvents.emit(
          "notification:show",
          "Batch update failed: " + (result?.error ?? "Unknown error"),
          "error",
        );
      }
    } catch (err) {
      appEvents.emit("notification:show", "Error: " + String(err), "error");
    } finally {
      setBatchSaving(false);
    }
  };

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProducts(
        search,
        buildProductListFilters(filters),
      );
      setProducts(data as unknown as Product[]);
    } catch (error) {
      logger.error("Failed to load products:", error);
      // Surface it — a swallowed failure here looks exactly like "the list
      // just stopped responding to the filters" (the rows on screen are the
      // last successful result, still rendered).
      appEvents.emit(
        "notification:show",
        `Failed to load products: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setLoading(false);
    }
    // `api` is the module-level ElectronApiAdapter singleton (api/adapter.ts)
    // handed down by ApiProvider — a stable reference, so listing it here
    // costs nothing and keeps this callback honest for exhaustive-deps.
  }, [api, search, filters]);

  /** Distinct category/supplier values for the two dropdowns. Refreshed after
   *  mutations only — NOT on every debounced reload. */
  const loadFilterOptions = useCallback(async () => {
    try {
      const options = await api.getProductFilterOptions();
      setFilterOptions({
        categories: options.categories ?? [],
        suppliers: options.suppliers ?? [],
      });
    } catch (error) {
      logger.error("Failed to load product filter options:", error);
    }
  }, [api]);

  // Debounce search AND filter changes (loadProducts' identity carries both).
  useEffect(() => {
    const timer = setTimeout(() => {
      loadProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, filters, loadProducts]);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  const setFilterField = useCallback(
    (field: NumericFilterField, value: string) => {
      setFilters((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleClearChip = useCallback((key: ProductFilterChipKey) => {
    setFilters((prev) => clearFilterGroup(prev, key));
  }, []);

  const chips = activeFilterChips(filters);
  const numericFilterCount = countNumericFilters(filters);

  // LIRA-143 Phase 6b (decision #7) — the walk-in IMEI lookup: when the
  // search box looks like an IMEI, fetch and render every unit's story
  // above the product list. Silent when there is no match (never shows a
  // loading/error state of its own) — an IMEI-looking search term still
  // runs the normal product-name/barcode search below in parallel, so a
  // non-match here costs nothing.
  const trimmedSearch = search.trim();
  const imeiSearchActive = looksLikeImei(trimmedSearch);
  const { data: unitStories = [] } = useUnitStoryQuery(
    imeiSearchActive ? trimmedSearch : null,
  );

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setIsFormOpen(true);
  };

  /**
   * The IN_STOCK IMEIs registered against each product about to be deleted.
   *
   * Probed for EVERY target, not only those whose category currently says it
   * tracks IMEIs: `tracks_imei_units` is inherited from the CATEGORY, so a
   * product that was re-categorised (or whose category later had the flag
   * turned off) can still hold registered units — and a delete dialog that
   * under-reports a destructive cascade is exactly the failure this exists to
   * prevent. One indexed read per product, chunked so a large batch selection
   * doesn't open one request per product at once.
   *
   * A failed read yields an entry with NO imeis plus `probeFailed` — the
   * message then says the check was incomplete instead of implying zero.
   * Entries stay 1:1 with `targets` so the copy can tell "this product" from
   * "these products" by count, even when some reads failed.
   */
  const probeInStockUnits = async (
    targets: Product[],
  ): Promise<{ entries: UnitDeleteEntry[]; probeFailed: boolean }> => {
    const UNIT_PROBE_CONCURRENCY = 8;
    const entries: UnitDeleteEntry[] = [];
    let probeFailed = false;

    for (let i = 0; i < targets.length; i += UNIT_PROBE_CONCURRENCY) {
      const chunk = targets.slice(i, i + UNIT_PROBE_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (product) => {
          try {
            const units = (await api.productUnits.getForProduct(
              product.id,
              "IN_STOCK",
            )) as Array<{ imei: string }>;
            return {
              entry: { name: product.name, imeis: units.map((u) => u.imei) },
              failed: false,
            };
          } catch (error) {
            logger.error("Failed to read registered IMEIs before delete:", {
              productId: product.id,
              error,
            });
            return { entry: { name: product.name, imeis: [] }, failed: true };
          }
        }),
      );
      for (const result of results) {
        entries.push(result.entry);
        if (result.failed) probeFailed = true;
      }
    }

    return { entries, probeFailed };
  };

  /** Open the single-product delete confirm, then fill in its IMEI
   *  disclosure. The dialog opens immediately — the read only decides whether
   *  an extra paragraph appears in it. */
  const requestDelete = async (product: Product) => {
    setDeleteUnitWarning(null);
    setShowDeleteConfirm({ id: product.id });
    setCheckingUnits(true);
    try {
      const { entries, probeFailed } = await probeInStockUnits([product]);
      setDeleteUnitWarning(buildUnitDeleteWarning(entries, probeFailed));
    } finally {
      setCheckingUnits(false);
    }
  };

  /** Same, for the batch-delete confirm over the current selection. */
  const requestBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleteUnitWarning(null);
    setShowBatchDeleteConfirm(true);
    setCheckingUnits(true);
    try {
      const targets = products.filter((p) => selectedIds.has(p.id));
      const { entries, probeFailed } = await probeInStockUnits(targets);
      setDeleteUnitWarning(buildUnitDeleteWarning(entries, probeFailed));
    } finally {
      setCheckingUnits(false);
    }
  };

  /** The confirm's base copy plus the IMEI disclosure (or the in-flight
   *  notice), so both dialogs compose their message the same way. */
  const composeDeleteMessage = (base: string): string => {
    if (checkingUnits) return `${base}\n\nChecking for registered IMEIs…`;
    return deleteUnitWarning ? `${base}\n\n${deleteUnitWarning}` : base;
  };

  const closeDeleteConfirms = () => {
    setShowDeleteConfirm(null);
    setShowBatchDeleteConfirm(false);
    setDeleteUnitWarning(null);
  };

  const handleDelete = async (id: number) => {
    try {
      const result = await api.deleteProduct(id);

      if (result && !result.success) {
        appEvents.emit(
          "notification:show",
          result.error || "Failed to delete product",
          "error",
        );
        return;
      }

      appEvents.emit(
        "notification:show",
        "Product deleted successfully",
        "success",
      );
      loadProducts(); // Refresh list
      loadFilterOptions();
      closeDeleteConfirms();
      // Windows focus fix
      window.api?.display?.fixFocus();
    } catch (error) {
      appEvents.emit("notification:show", "Failed to delete product", "error");
      logger.error("Failed to delete:", error);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;

    try {
      const ids = Array.from(selectedIds);
      const result = window.api
        ? await (window.api as any).inventory.batchDelete(ids)
        : null;

      if (result && !result.success) {
        appEvents.emit(
          "notification:show",
          result.error || "Failed to delete products",
          "error",
        );
        return;
      }

      const deleted = result?.deleted ?? ids.length;
      appEvents.emit(
        "notification:show",
        `${deleted} product${deleted !== 1 ? "s" : ""} deleted`,
        "success",
      );
      closeDeleteConfirms();
      // Windows focus fix
      window.api?.display?.fixFocus();
    } catch (error) {
      appEvents.emit("notification:show", "Failed to delete products", "error");
      logger.error("Batch delete failed:", error);
    }

    setSelectedIds(new Set());
    loadProducts();
    loadFilterOptions();
  };

  const handleSave = () => {
    setIsFormOpen(false);
    setEditingProduct(null);
    loadProducts();
    loadFilterOptions();
    appEvents.emit(
      "notification:show",
      editingProduct
        ? "Product updated successfully"
        : "Product created successfully",
      "success",
    );
    // Windows focus fix
    window.api?.display?.fixFocus();
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setEditingProduct(null);
    // Windows focus fix
    window.api?.display?.fixFocus();
  };

  const handleMinimizeProduct = (data: {
    formData: MinimizedProduct["formData"];
    editingProduct: Product | null;
  }) => {
    const minimizedProduct: MinimizedProduct = {
      id: `product-${Date.now()}`,
      formData: data.formData,
      editingProduct: data.editingProduct,
      createdAt: new Date().toISOString(),
    };
    setMinimizedProducts((prev) => [...prev, minimizedProduct]);
    setIsFormOpen(false);
    setEditingProduct(null);
  };

  const handleRestoreProduct = (productId: string) => {
    const minimized = minimizedProducts.find((p) => p.id === productId);
    if (!minimized) return;

    setEditingProduct(minimized.editingProduct);
    setInitialFormData(minimized.formData);
    setIsFormOpen(true);
    setMinimizedProducts((prev) => prev.filter((p) => p.id !== productId));
  };

  const handleCancelMinimizedProduct = (
    productId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setMinimizedProducts((prev) => prev.filter((p) => p.id !== productId));
  };

  const [initialFormData, setInitialFormData] = useState<
    MinimizedProduct["formData"] | null
  >(null);

  // Persist minimized products to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "products_minimized_forms",
        JSON.stringify(minimizedProducts),
      );
    } catch (error) {
      logger.error("Failed to save minimized products:", error);
    }
  }, [minimizedProducts]);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);

    try {
      const text = await file.text();
      const records = parseToonFile(text);
      if (records.length === 0) {
        appEvents.emit(
          "notification:show",
          "No records found in file",
          "error",
        );
        setIsImporting(false);
        return;
      }

      // Snapshot existing products for conflict detection (avoids N+1 lookups)
      const existingProducts = [...products];

      const results: ImportResult[] = [];
      for (const rec of records) {
        if (!rec.name) continue;
        try {
          const barcode = rec.code && rec.code.trim() ? rec.code.trim() : null;

          // Pre-check barcode collision against already-loaded products
          if (barcode) {
            const conflict = existingProducts.find(
              (p) =>
                p.barcode && p.barcode.toString().trim() === barcode.toString(),
            );
            if (conflict) {
              results.push({
                name: rec.name,
                success: false,
                error: `Barcode already used by: "${conflict.name}"`,
              });
              continue;
            }
          }

          const result = await api.createProduct({
            barcode,
            name: rec.name,
            category: rec.category ?? "General",
            cost_price: rec.cost ?? 0,
            retail_price: rec.price ?? 0,
            stock_quantity: rec.stockQuantity ?? 0,
            min_stock_level: 5,
            unit: rec.unit ?? null,
            supplier: rec.supplier ?? null,
          } as any);
          const importResult: ImportResult = {
            name: rec.name,
            success: result.success,
          };
          if (!result.success) {
            importResult.error = result.error ?? "Unknown error";
          }
          results.push(importResult);
        } catch (err) {
          results.push({ name: rec.name, success: false, error: String(err) });
        }
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      if (failed === 0) {
        appEvents.emit(
          "notification:show",
          `Import Results — ${succeeded} succeeded. All items imported successfully.`,
          "success",
          8000,
        );
      } else {
        appEvents.emit(
          "notification:show",
          `Import Results — ${succeeded} succeeded, ${failed} failed.`,
          "warning",
          8000,
        );
        // Emit individual errors for failed items
        results
          .filter((r) => !r.success)
          .forEach((r) =>
            appEvents.emit(
              "notification:show",
              `Failed: ${r.name} — ${r.error}`,
              "error",
              10000,
            ),
          );
      }

      loadProducts();
      loadFilterOptions();
      // Windows focus fix
      window.api?.display?.fixFocus();
    } catch (err) {
      logger.error("Import failed", { error: err });
      appEvents.emit(
        "notification:show",
        `Import failed: ${String(err)}`,
        "error",
      );
    } finally {
      setIsImporting(false);
      // Reset file input so the same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      {/* Hidden file input for .toon import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".toon,.csv,.txt"
        className="hidden"
        onChange={handleImportFile}
      />

      <PageHeader
        icon={Package}
        title="Inventory"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50"
            >
              <Upload size={18} />
              {isImporting ? "Importing..." : "Import .toon"}
            </button>
            {/* LIRA-143 — entry point for the shop-wide IMEI register
                (/inventory/units). Deliberately not in the sidebar. */}
            <button
              onClick={() => navigate("/inventory/units")}
              data-testid="phone-units-entry"
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-all"
            >
              <Smartphone size={18} />
              Phone Units
            </button>
            <button
              onClick={() => setIsFormOpen(true)}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-violet-900/20"
            >
              <Plus size={20} />
              Add Product
            </button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[16rem] max-w-md">
            <Search className="absolute left-3 top-2.5 text-slate-500 h-5 w-5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, barcode..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
            />
          </div>

          <MultiSelect
            label="Category"
            testId="inventory-filter-category"
            className="w-44"
            values={filters.categories}
            onChange={(categories) =>
              setFilters((prev) => ({ ...prev, categories }))
            }
            options={filterOptions.categories}
          />

          <MultiSelect
            label="Supplier"
            testId="inventory-filter-supplier"
            className="w-44"
            values={filters.suppliers}
            onChange={(suppliers) =>
              setFilters((prev) => ({ ...prev, suppliers }))
            }
            options={filterOptions.suppliers}
          />

          <DateRangeFilter
            from={filters.addedFrom}
            to={filters.addedTo}
            onFromChange={(addedFrom) =>
              setFilters((prev) => ({ ...prev, addedFrom }))
            }
            onToChange={(addedTo) =>
              setFilters((prev) => ({ ...prev, addedTo }))
            }
          />

          <InventoryFiltersPopover
            filters={filters}
            onFieldChange={setFilterField}
            onReset={() => setFilters((prev) => clearNumericFilters(prev))}
            activeCount={numericFilterCount}
          />
        </div>

        {/* Active-filter chips — one per active filter GROUP */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 pt-3">
            {chips.map((chip) => (
              <span
                key={chip.key}
                data-testid={`inventory-filter-chip-${chip.key}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-600/15 px-2.5 py-1 text-xs text-violet-200"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={() => handleClearChip(chip.key)}
                  aria-label={`Remove filter ${chip.label}`}
                  className="text-violet-300 transition-colors hover:text-white"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setFilters(EMPTY_PRODUCT_FILTERS)}
              data-testid="inventory-filters-clear"
              className="ml-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* LIRA-143 Phase 6b — walk-in IMEI lookup card(s), shown above the
          product list only when the search term matches the lookup
          heuristic AND at least one unit story came back. */}
      {imeiSearchActive && unitStories.length > 0 && (
        <div className="space-y-2">
          {unitStories.map((story) => (
            <ImeiStoryCard key={story.id} story={story} />
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto shadow-xl">
        <DataTable
          headerActions={
            selectedIds.size > 0 ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700/50 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
                  title="Clear selection"
                >
                  <X size={14} />
                </button>
                <button
                  onClick={() => {
                    setBatchFields({});
                    setShowBatchModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600/20 px-3 py-1.5 text-xs font-medium text-violet-400 hover:bg-violet-600/30 transition-colors cursor-pointer"
                >
                  <Layers size={14} />
                  Batch Edit ({selectedIds.size})
                </button>
                <button
                  onClick={requestBatchDelete}
                  data-testid="inventory-batch-delete"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                  Delete ({selectedIds.size})
                </button>
              </div>
            ) : undefined
          }
          selectAll={{
            checked: allSelected,
            indeterminate: someSelected,
            onChange: (checked) => {
              // Select/deselect ALL items across ALL pages
              if (checked) {
                setSelectedIds(new Set(products.map((p) => p.id)));
              } else {
                setSelectedIds(new Set());
              }
            },
          }}
          columns={[
            {
              header: "",
              className: "p-4 border-b border-slate-700",
              width: "48px",
            },
            {
              header: "Info",
              sortKey: "name",
              className: "p-4 border-b border-slate-700",
            },
            {
              header: "Category",
              sortKey: "category",
              className: "p-4 border-b border-slate-700",
            },
            {
              header: "Supplier",
              sortKey: "supplier",
              className: "p-4 border-b border-slate-700",
            },
            {
              header: "Added",
              sortKey: "created_at",
              className: "p-4 border-b border-slate-700",
              width: "110px",
            },
            {
              header: "Cost",
              sortKey: "cost_price",
              className: "p-4 border-b border-slate-700",
              width: "90px",
            },
            {
              header: "Retail",
              sortKey: "retail_price",
              className: "p-4 border-b border-slate-700",
              width: "90px",
            },
            {
              header: "Profit %",
              sortKey: "profit_percent",
              className: "p-4 border-b border-slate-700",
            },
            {
              header: "Stock",
              sortKey: "stock_quantity",
              className: "p-4 border-b border-slate-700",
              width: "90px",
            },
            {
              header: "Actions",
              className: "p-4 border-b border-slate-700 text-right",
              width: "90px",
            },
          ]}
          data={products}
          onVisibleRowsChange={(rows) => {
            visibleProductsRef.current = rows;
          }}
          onShiftSelect={handleShiftSelect}
          onAnchorReset={() => {
            lastShiftRangeRef.current = new Set();
          }}
          getSortValue={(product, key) => {
            if (key === "supplier") return (product as any).supplier ?? "";
            if (key === "created_at")
              return product.created_at
                ? parseDbDate(product.created_at).getTime()
                : 0;
            if (key === "profit_percent") {
              const cp = product.cost_price || 0;
              const rp = product.retail_price || 0;
              return cp > 0 ? ((rp - cp) / cp) * 100 : rp > 0 ? 999999 : 0;
            }
            return (product as any)[key] ?? "";
          }}
          paginate
          pageSize={20}
          pageLabel="products"
          loading={loading}
          emptyMessage="No products found."
          exportExcel
          exportPdf
          exportFilename="products"
          className="w-full text-left border-collapse"
          theadClassName="bg-slate-800/50 text-slate-400 text-xs uppercase font-semibold"
          tbodyClassName="divide-y divide-slate-700 text-sm"
          renderRow={(product) => {
            const isSelected = selectedIds.has(product.id);
            return (
              <tr
                key={product.id}
                className={`cursor-pointer transition-colors ${isSelected ? "bg-violet-900/20 hover:bg-violet-900/30" : "hover:bg-slate-700/50"}`}
                onClick={(e) => {
                  // If click came from the checkbox input, let onChange handle
                  // the toggle — only set anchor (handled by DataTable cloneElement).
                  const fromCheckbox = (e.target as HTMLElement).matches(
                    'input[type="checkbox"]',
                  );
                  if (!e.shiftKey && !fromCheckbox) toggleSelectOne(product.id);
                }}
              >
                <td className="p-4">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      // Suppress onChange on shift+click — the row onClick
                      // + DataTable handleRowClick will handle the range-select
                      if (
                        e.nativeEvent instanceof MouseEvent &&
                        e.nativeEvent.shiftKey
                      )
                        return;
                      toggleSelectOne(product.id);
                    }}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-violet-600 cursor-pointer"
                  />
                </td>
                <td className="p-4">
                  <div className="font-medium text-white">{product.name}</div>
                  <div className="text-slate-500 text-xs font-mono">
                    {product.barcode}
                  </div>
                </td>
                <td className="p-4 text-slate-300">
                  <span className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-xs">
                    {product.category}
                  </span>
                </td>
                <td className="p-4 text-slate-400 text-xs">
                  {(product as any).supplier ? (
                    <span className="text-slate-300">
                      {(product as any).supplier}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="p-4 text-slate-400 text-xs">
                  {product.created_at
                    ? parseDbDate(product.created_at).toLocaleDateString()
                    : "-"}
                </td>
                <td className="p-4 text-slate-400">
                  ${(product.cost_price ?? 0).toFixed(2)}
                </td>
                <td className="p-4 text-green-400 font-medium">
                  ${(product.retail_price ?? 0).toFixed(2)}
                </td>
                <td className="p-4 text-violet-400 font-medium">
                  {(() => {
                    const cp = product.cost_price || 0;
                    const rp = product.retail_price || 0;
                    if (cp <= 0) return rp > 0 ? "100%" : "0%";
                    return `${(((rp - cp) / cp) * 100).toFixed(1)}%`;
                  })()}
                </td>
                <td className="p-4">
                  <div
                    className={`font-medium ${(product.stock_quantity ?? 0) <= (product.min_stock_level ?? 5) ? "text-red-400" : "text-slate-300"}`}
                  >
                    {product.stock_quantity ?? 0} units
                  </div>
                </td>
                <td className="p-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAdjustingProduct(product);
                      }}
                      className="p-2 text-slate-400 hover:text-violet-400 hover:bg-violet-400/10 rounded transition-colors"
                      title="Adjust stock"
                    >
                      <PackagePlus size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(product);
                      }}
                      className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(product);
                      }}
                      data-testid={`inventory-delete-${product.id}`}
                      aria-label={`Delete ${product.name}`}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          }}
        />
      </div>

      {/* Batch Edit Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-white">Batch Edit</h2>
                <p className="text-sm text-slate-400 mt-0.5">
                  Updating{" "}
                  <span className="text-violet-400 font-medium">
                    {selectedIds.size}
                  </span>{" "}
                  selected product{selectedIds.size !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={() => setShowBatchModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500 bg-slate-900/50 rounded-lg px-3 py-2">
                Only fill in the fields you want to change. Blank fields will be
                left unchanged. Unique fields (name, barcode, price) cannot be
                batch-edited.
              </p>

              <div className="grid grid-cols-2 gap-4">
                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={batchFields.category ?? ""}
                    onChange={(e) =>
                      setBatchFields((p) => ({
                        ...p,
                        category: e.target.value,
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
                  />
                </div>

                {/* Supplier */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Supplier
                  </label>
                  <input
                    type="text"
                    value={batchFields.supplier ?? ""}
                    onChange={(e) =>
                      setBatchFields((p) => ({
                        ...p,
                        supplier: e.target.value,
                      }))
                    }
                    placeholder="Supplier name (optional)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
                  />
                </div>

                {/* Quantity (unit) */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Quantity
                  </label>
                  <input
                    type="text"
                    value={batchFields.unit ?? ""}
                    onChange={(e) =>
                      setBatchFields((p) => ({ ...p, unit: e.target.value }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
                  />
                </div>

                {/* Min. Stock Alert */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Min. Stock Alert
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={batchFields.min_stock_level ?? ""}
                    onChange={(e) =>
                      setBatchFields((p) => ({
                        ...p,
                        min_stock_level: e.target.value,
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-slate-700">
              <button
                onClick={() => setShowBatchModal(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchSave}
                disabled={batchSaving}
                className="flex-1 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors text-sm disabled:opacity-50"
              >
                {batchSaving
                  ? "Saving…"
                  : `Update ${selectedIds.size} Products`}
              </button>
            </div>
          </div>
        </div>
      )}

      {isFormOpen && (
        <ProductForm
          onClose={handleClose}
          onSave={handleSave}
          product={editingProduct}
          onMinimize={handleMinimizeProduct}
          initialFormData={initialFormData}
        />
      )}

      {adjustingProduct && (
        <AdjustStockModal
          product={adjustingProduct}
          onClose={() => setAdjustingProduct(null)}
          onSuccess={() => {
            setAdjustingProduct(null);
            loadProducts();
            // Windows focus fix
            window.api?.display?.fixFocus();
          }}
        />
      )}

      {/* Confirmation Modals */}
      {/* LIRA-143 item #7 — both dialogs disclose the registered IN_STOCK
          IMEIs the delete cascade will also remove (composed by
          `composeDeleteMessage`); a product with none reads exactly as before.
          The confirm label reports the in-flight check so a confirm made
          inside that window isn't a blind one. */}
      <ConfirmModal
        isOpen={showDeleteConfirm !== null}
        title="Delete Product"
        message={composeDeleteMessage(
          "Are you sure you want to delete this product? This action cannot be undone.",
        )}
        confirmLabel={checkingUnits ? "Checking…" : "Confirm"}
        onConfirm={() =>
          showDeleteConfirm && handleDelete(showDeleteConfirm.id)
        }
        onCancel={closeDeleteConfirms}
        variant="danger"
      />

      <ConfirmModal
        isOpen={showBatchDeleteConfirm}
        title="Batch Delete Products"
        message={composeDeleteMessage(
          `Are you sure you want to delete ${selectedIds.size} selected products? This action cannot be undone.`,
        )}
        confirmLabel={checkingUnits ? "Checking…" : "Confirm"}
        onConfirm={handleBatchDelete}
        onCancel={closeDeleteConfirms}
        variant="danger"
      />

      {/* Minimized Products Bar */}
      {minimizedProducts.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-md border-t border-slate-700 shadow-2xl z-40">
          <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
            {minimizedProducts.map((product, index) => {
              const productName = product.formData.name || "New Product";
              const isEditing = product.editingProduct !== null;

              return (
                <button
                  key={product.id}
                  onClick={() => handleRestoreProduct(product.id)}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-violet-500 rounded-lg transition-all shrink-0 group min-w-[200px]"
                >
                  <Package size={16} className="text-violet-400" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-xs font-medium text-white truncate">
                      {productName}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {isEditing ? "Editing" : "New Product"}
                    </div>
                  </div>
                  {index === minimizedProducts.length - 1 && (
                    <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                  )}
                  <button
                    onClick={(e) => handleCancelMinimizedProduct(product.id, e)}
                    className="ml-1 p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                    title="Cancel"
                  >
                    <Trash2 size={14} />
                  </button>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
