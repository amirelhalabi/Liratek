import { useState, useEffect, useCallback, useRef } from "react";
import logger from "../../../../utils/logger";
import {
  Plus,
  Search,
  Package,
  Edit2,
  Trash2,
  Upload,
  X,
  Layers,
} from "lucide-react";
import { useAuth } from "../../../auth/context/AuthContext";
import { PageHeader, useApi, appEvents } from "@liratek/ui";
import ProductForm from "./ProductForm";
import type { Product } from "@liratek/ui";
import { DataTable } from "@/shared/components/DataTable";

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
  const [products, setProducts] = useState<Product[]>([]);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ── Batch selection ───────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  /** Tracks the current visible (sorted+paginated) product order from DataTable */
  const visibleProductsRef = useRef<Product[]>([]);
  /** IDs added by the last shift-select range — replaced on next shift-select */
  const lastShiftRangeRef = useRef<Set<number>>(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchFields, setBatchFields] = useState<BatchUpdateFields>({});
  const [batchSaving, setBatchSaving] = useState(false);

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
      } else {
        alert("Batch update failed: " + (result?.error ?? "Unknown error"));
      }
    } catch (err) {
      alert("Error: " + String(err));
    } finally {
      setBatchSaving(false);
    }
  };

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProducts(search);
      setProducts(data as unknown as Product[]);
    } catch (error) {
      logger.error("Failed to load products:", error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, loadProducts]);

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setIsFormOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    try {
      await api.deleteProduct(id);
      loadProducts(); // Refresh list
    } catch (error) {
      logger.error("Failed to delete:", error);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedIds.size} selected product${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`,
      )
    )
      return;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await api.deleteProduct(id);
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      logger.error(`${failed} product(s) failed to delete.`);
    }
    setSelectedIds(new Set());
    loadProducts();
  };

  const handleSave = () => {
    setIsFormOpen(false);
    setEditingProduct(null);
    loadProducts();
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setEditingProduct(null);
  };

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
    <div className="space-y-6">
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
            {isAdmin && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50"
              >
                <Upload size={18} />
                {isImporting ? "Importing..." : "Import .toon"}
              </button>
            )}
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
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 text-slate-500 h-5 w-5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, barcode..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
          />
        </div>
        {/* Add filters later (Category, etc) */}
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
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
                  onClick={handleBatchDelete}
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
            ...(isAdmin
              ? [
                  {
                    header: "Cost",
                    sortKey: "cost_price",
                    className: "p-4 border-b border-slate-700",
                    width: "90px",
                  },
                ]
              : []),
            {
              header: "Retail",
              sortKey: "retail_price",
              className: "p-4 border-b border-slate-700",
              width: "90px",
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
                ? new Date(product.created_at).getTime()
                : 0;
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
                    ? new Date(product.created_at).toLocaleDateString()
                    : "-"}
                </td>
                {isAdmin && (
                  <td className="p-4 text-slate-400">
                    ${(product.cost_price ?? 0).toFixed(2)}
                  </td>
                )}
                <td className="p-4 text-green-400 font-medium">
                  ${(product.retail_price ?? 0).toFixed(2)}
                </td>
                <td className="p-4">
                  <div
                    className={`font-medium ${(product.stock_quantity ?? 0) <= (product.min_stock_level ?? 5) ? "text-red-400" : "text-slate-300"}`}
                  >
                    {product.stock_quantity ?? 0} units
                  </div>
                </td>
                <td
                  className="p-4 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleEdit(product)}
                      className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(product.id)}
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
        />
      )}
    </div>
  );
}
