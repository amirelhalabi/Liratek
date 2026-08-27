import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import logger from "@/utils/logger";
import { X, Save, Printer, Minus, Sparkles } from "lucide-react";
import { useApi, appEvents, DecimalInput } from "@liratek/ui";
import type { Product } from "@liratek/ui";
import JsBarcode from "jsbarcode";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { ProductUnitsSection } from "../../components/ProductUnitsSection";
import { PRODUCT_UNITS_KEYS } from "../../hooks/useProductUnits";

interface ProductFormProps {
  onClose: () => void;
  onSave: () => void;
  product?: Product | null;
  prefillName?: string | undefined;
  prefillBarcode?: string | undefined;
  onMinimize?: (data: {
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
  }) => void;
  initialFormData?: {
    barcode: string;
    name: string;
    category: string;
    cost_price: number;
    retail_price: number;
    min_stock_level: number;
    stock_quantity: number;
    supplier: string;
  } | null;
}

export default function ProductForm({
  onClose,
  onSave,
  product,
  prefillName,
  prefillBarcode,
  onMinimize,
  initialFormData,
}: ProductFormProps) {
  useModalFocusFix(true);
  const api = useApi();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  // LIRA-143 Phase 6b — warranty (months), free-standing state rather than
  // part of `formData`: `formData`'s inferred type is a union with the
  // `initialFormData` prop's fixed shape (the minimize/restore snapshot),
  // which doesn't carry this field. Empty string = "no warranty" (-> null).
  const [warrantyMonths, setWarrantyMonths] = useState<string>(
    product?.warranty_months != null ? String(product.warranty_months) : "",
  );
  // LIRA-143 Phase 6b — categories with their `tracks_imei_units` flag,
  // fetched once so the Units/IMEIs section's visibility follows the
  // CURRENTLY SELECTED category live (including a category the operator
  // just typed/switched to in this form), rather than the possibly-stale
  // flag baked onto the product row at load time.
  const [categoriesFull, setCategoriesFull] = useState<
    Array<{ name: string; tracks_imei_units: number }>
  >([]);
  const [duplicateInfo, setDuplicateInfo] = useState<null | {
    attempted: string;
    suggested: string;
  }>(null);
  const [formData, setFormData] = useState(() => {
    if (initialFormData) {
      return initialFormData;
    }
    return {
      barcode: prefillBarcode || "",
      name: prefillName || "",
      category: "Accessories",
      cost_price: 0,
      retail_price: 0,
      min_stock_level: 5,
      stock_quantity: 0,
      supplier: "" as string,
    };
  });

  useEffect(() => {
    if (product && !initialFormData) {
      setFormData({
        barcode: product.barcode,
        name: product.name,
        category: product.category,
        cost_price: product.cost_price,
        retail_price: product.retail_price,
        min_stock_level: product.min_stock_level,
        stock_quantity: product.stock_quantity,
        supplier: (product as any).supplier ?? "",
      });
      setWarrantyMonths(
        product.warranty_months != null ? String(product.warranty_months) : "",
      );
    }
  }, [product, initialFormData]);

  useEffect(() => {
    const loadCategoriesFull = async () => {
      try {
        const data = await api.getCategoriesFull();
        setCategoriesFull(data ?? []);
      } catch {
        setCategoriesFull([]);
      }
    };
    loadCategoriesFull();
  }, [api]);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const data = (await window.api?.inventory?.getCategories?.()) || [];
        const fallback = [
          "Accessories",
          "Phones",
          "Chargers",
          "Audio",
          "Parts",
          "Services",
        ];
        setCategories(Array.isArray(data) ? data : fallback);
      } catch {
        // Default fallback list
        setCategories([
          "Accessories",
          "Phones",
          "Chargers",
          "Audio",
          "Parts",
          "Services",
        ]);
      }
    };
    loadCategories();
  }, [api]);

  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const data =
          (await window.api?.inventory?.getProductSuppliers?.()) || [];
        setSupplierNames(Array.isArray(data) ? data : []);
      } catch {
        setSupplierNames([]);
      }
    };
    loadSuppliers();
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "number" ? parseFloat(value) : value,
    }));
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateBarcode = useCallback(async () => {
    setIsGenerating(true);
    try {
      // Get shop name from settings to derive prefix
      let prefix = "LT";
      try {
        const settings = await api.getAllSettings();
        const shopSetting = settings.find(
          (s: any) => s.key_name === "shop_name",
        );
        if (shopSetting?.value) {
          // Extract first letters of each word, e.g. "Corner Tech" → "CT"
          const words = shopSetting.value.trim().split(/\s+/);
          const initials = words
            .map((w: string) => w.charAt(0).toUpperCase())
            .join("");
          if (initials.length >= 1) prefix = initials;
        }
      } catch {
        // Use default prefix
      }

      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yy = String(now.getFullYear()).slice(-2);
      const datePart = `${mm}${yy}`;

      // Try up to 10 times to find a unique barcode
      for (let attempt = 0; attempt < 10; attempt++) {
        const random = String(Math.floor(10000 + Math.random() * 90000)); // 5-digit
        const barcode = `${prefix}-${datePart}-${random}`;

        // Check if barcode already exists
        try {
          const existing =
            await window.api?.inventory?.getProductByBarcode?.(barcode);
          if (!existing) {
            setFormData((prev) => ({ ...prev, barcode }));
            return;
          }
        } catch {
          // If check fails, assume it's unique
          setFormData((prev) => ({ ...prev, barcode }));
          return;
        }
      }

      // Fallback: use timestamp-based barcode
      const fallback = `${prefix}-${datePart}-${Date.now().toString().slice(-5)}`;
      setFormData((prev) => ({ ...prev, barcode: fallback }));
    } catch (err) {
      logger.error("Failed to generate barcode", { error: err });
    } finally {
      setIsGenerating(false);
    }
  }, [api]);

  const [printCopies, setPrintCopies] = useState(1);

  const handlePrintBarcode = useCallback(async () => {
    const barcode = formData.barcode?.trim();
    if (!barcode) return;

    const copies = Math.max(1, Math.min(printCopies, 999));

    // Create an offscreen SVG, render the barcode as vector for crisp printing
    const svgNs = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(svgNs, "svg");
    try {
      JsBarcode(svgEl, barcode, {
        format: "CODE128",
        width: 0.8,
        height: 30,
        displayValue: true,
        fontSize: 10,
        fontOptions: "bold",
        margin: 1,
        textMargin: 1,
      });
    } catch {
      logger.error("Failed to generate barcode", { barcode });
      return;
    }

    const svgString = new XMLSerializer().serializeToString(svgEl);

    // Build label HTML — one per copy, each on its own page
    const labels = Array.from({ length: copies })
      .map(() => `<div class="label">${svgString}</div>`)
      .join("\n");

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<title>Barcode</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 58mm; height: 30mm; margin: 0; padding: 0; }
  
  /* The container is 58mm wide and 30mm high */
  .label {
    width: 58mm;
    height: 30mm;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 1mm 2mm;
  }
  
  /* Barcode SVG scales to fill the label without pixelation */
  svg { 
    width: auto;
    height: auto;
    max-width: 54mm;
    max-height: 26mm;
    display: block;
    margin: 0 auto;
  }
  
  @media print {
    /* Set page dimension to match the label tape */
    @page { size: 58mm 30mm; margin: 0; }
    html, body { width: 58mm; height: 30mm; margin: 0; padding: 0; }
    .label { page-break-after: always; }
    .label:last-child { page-break-after: auto; }
  }
</style>
</head>
<body>
${labels}
</body>
</html>`;

    // Fetch the target barcode printer from settings
    let targetPrinter = "";
    try {
      const settings = await api.getAllSettings();
      const barcodeSetting = settings.find(
        (s: any) => s.key_name === "barcode_printer",
      );
      if (barcodeSetting && barcodeSetting.value) {
        targetPrinter = barcodeSetting.value;
      }
    } catch (e) {
      logger.warn("Failed to get printer setting", { error: e });
    }

    if (targetPrinter && window.api?.print?.silentPrint) {
      logger.info(
        `Sending barcode to silent printer: ${targetPrinter} (${copies} copies)`,
      );
      const result = await window.api.print.silentPrint(
        htmlContent,
        targetPrinter,
        {
          pageSize: { width: 58000, height: 30000 },
          margins: { marginType: "none" },
        },
      );
      if (!result?.success) {
        logger.error(`Silent print failed: ${result?.error}`);
        appEvents.emit(
          "notification:show",
          "Barcode printing failed: " + (result?.error || "Unknown error"),
          "error",
        );
      }
    } else {
      // Fallback to traditional browser window print (with the new CSS fixes)
      logger.info(
        "Silent printing unavailable or no designated printer, falling back to window.print",
      );
      const printWindow = window.open("", "", "width=340,height=260");
      if (!printWindow) {
        appEvents.emit(
          "notification:show",
          "Popup blocked. Please allow popups to print barcodes.",
          "error",
        );
        return;
      }

      printWindow.document.write(htmlContent);
      printWindow.document.close();

      const images = Array.from(printWindow.document.images);
      Promise.all(
        images.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((r) => {
                img.onload = () => r();
                img.onerror = () => r();
              }),
        ),
      ).then(() => {
        printWindow.focus();
        printWindow.print();
        printWindow.close();
        // Windows focus fix
        setTimeout(() => {
          window.api?.display?.fixFocus?.();
        }, 100);
      });
    }
  }, [formData.barcode, printCopies, api]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setDuplicateInfo(null);
    setIsLoading(true);

    const warrantyMonthsValue =
      warrantyMonths.trim() === "" ? null : Number(warrantyMonths);

    try {
      let result;
      if (product) {
        // Update: include the existing id for the database to locate the row
        const updatePayload = {
          ...formData,
          id: product.id,
          supplier: formData.supplier || null,
          warranty_months: warrantyMonthsValue,
        };
        result = await api.updateProduct(product.id, updatePayload);
      } else {
        // Create: never send id — the database auto-generates it
        const createPayload = {
          ...formData,
          supplier: formData.supplier || null,
          warranty_months: warrantyMonthsValue,
        };
        result = await api.createProduct(createPayload);
      }

      if (result.success) {
        // The phone-unit reads carry their PRODUCT's `warranty_months` (so
        // unsold stock can show "N mo — starts at sale"), and a product save
        // can change it without touching a single `product_units` row — no
        // unit mutation runs, so nothing else invalidates these keys. With
        // the app's 30s default `staleTime`, walking back to /inventory/units
        // right after an edit otherwise re-rendered the CACHED pre-edit term
        // (owner-reported 2026-08-26). Invalidated by PREFIX so every
        // filter/page combination and every expanded IMEI story refetches.
        queryClient.invalidateQueries({
          queryKey: PRODUCT_UNITS_KEYS.listRoot,
        });
        queryClient.invalidateQueries({
          queryKey: PRODUCT_UNITS_KEYS.storyRoot,
        });
        onSave();
      } else {
        if (result.code === "DUPLICATE_BARCODE" && result.suggested_barcode) {
          setDuplicateInfo({
            attempted: formData.barcode,
            suggested: result.suggested_barcode,
          });
          return;
        }
        setError(result.error || "Failed to save product");
      }
    } catch (err) {
      logger.error("Operation failed", { error: err });
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  // LIRA-143 Phase 6b — the Units/IMEIs section's visibility follows the
  // CURRENTLY selected/typed category name, not `product.tracks_imei_units`
  // (which reflects the category the product was saved under, potentially
  // stale the moment the operator edits the category field in this form).
  const categoryTracksImei = categoriesFull.some(
    (c) => c.name === formData.category && c.tracks_imei_units === 1,
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="presentation"
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex justify-between items-center p-6 border-b border-slate-700 bg-slate-800">
          <h2 className="text-xl font-bold text-white">
            {product ? "Edit Product" : "New Product"}
          </h2>
          <div className="flex items-center gap-2">
            {onMinimize && (
              <button
                onClick={() =>
                  onMinimize({
                    formData,
                    editingProduct: product || null,
                  })
                }
                className="text-slate-400 hover:text-white p-1"
                title="Minimize"
              >
                <Minus size={24} />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-4">
            {duplicateInfo && (
              <div className="bg-slate-950 border border-amber-500/40 rounded-lg p-4 text-sm">
                <div className="font-semibold text-amber-300 mb-1">
                  Duplicate Barcode Detected
                </div>
                <div className="text-slate-300">
                  The barcode{" "}
                  <span className="font-mono">{duplicateInfo.attempted}</span>{" "}
                  already exists.
                </div>
                <div className="text-slate-400 mt-1">
                  Suggested:{" "}
                  <span className="font-mono">{duplicateInfo.suggested}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFormData((prev) => ({
                        ...prev,
                        barcode: duplicateInfo.suggested,
                      }));
                      setDuplicateInfo(null);
                    }}
                    className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium"
                  >
                    Duplicate Barcode
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuplicateInfo(null)}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm border border-red-500/50">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* Row 1: Product Name | Barcode */}
              <div>
                <label
                  htmlFor="product-name"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Product Name
                </label>
                <input
                  id="product-name"
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
                  required
                />
              </div>

              {/* Row 1 col 2: Barcode | Row 2: Category */}
              <div>
                <label
                  htmlFor="product-barcode"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Barcode
                </label>
                <div className="flex gap-2">
                  <input
                    id="product-barcode"
                    name="barcode"
                    type="text"
                    value={formData.barcode}
                    onChange={handleChange}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                      }
                    }}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
                  />
                  <button
                    type="button"
                    onClick={handleGenerateBarcode}
                    disabled={isGenerating}
                    title="Generate barcode"
                    className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1 text-sm"
                  >
                    <Sparkles size={16} />
                  </button>
                </div>
              </div>
              <div>
                <label
                  htmlFor="product-category"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Category
                </label>
                <input
                  id="product-category"
                  type="text"
                  list="category-options"
                  value={formData.category}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      category: e.target.value,
                    }))
                  }
                  placeholder="Select or type category name"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600 focus:outline-none"
                />
                <datalist id="category-options">
                  {categories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              {/* Row 3: Supplier | Quantity */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">
                  Supplier
                </label>
                <input
                  type="text"
                  list="supplier-options"
                  value={formData.supplier ?? ""}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      supplier: e.target.value,
                    }))
                  }
                  placeholder="Select or type supplier name"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600 focus:outline-none"
                />
                <datalist id="supplier-options">
                  {supplierNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              {/* Row 4: Cost Price | Retail Price */}
              <div>
                <label
                  htmlFor="product-cost-price"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Cost Price ($)
                </label>
                <DecimalInput
                  id="product-cost-price"
                  name="cost_price"
                  value={formData.cost_price}
                  onChange={(cost_price) =>
                    setFormData((prev) => ({ ...prev, cost_price }))
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="product-retail-price"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Retail Price ($)
                </label>
                <DecimalInput
                  id="product-retail-price"
                  name="retail_price"
                  value={formData.retail_price}
                  onChange={(retail_price) =>
                    setFormData((prev) => ({ ...prev, retail_price }))
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
                  required
                />
              </div>

              {/* Row 5: Min Stock Alert (half width) */}
              <div>
                <label
                  htmlFor="product-stock"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Quantity
                </label>
                <input
                  id="product-stock"
                  name="stock_quantity"
                  type="number"
                  value={formData.stock_quantity}
                  onChange={handleChange}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
                />
              </div>

              <div>
                <label
                  htmlFor="product-min-stock"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Min. Stock Alert
                </label>
                <input
                  id="product-min-stock"
                  name="min_stock_level"
                  type="number"
                  value={formData.min_stock_level}
                  onChange={handleChange}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
                />
              </div>

              {/* LIRA-143 Phase 6b: warranty length in months, empty = none */}
              <div>
                <label
                  htmlFor="product-warranty-months"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Warranty (months)
                </label>
                <input
                  id="product-warranty-months"
                  type="number"
                  min={0}
                  step={1}
                  value={warrantyMonths}
                  onChange={(e) => setWarrantyMonths(e.target.value)}
                  placeholder="No warranty"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
                />
              </div>
            </div>

            {/* LIRA-143 Phase 6b — Units/IMEIs, only for a category that tracks
                them AND an already-saved product (unit registration needs a
                product id). */}
            {categoryTracksImei &&
              (product?.id != null ? (
                <ProductUnitsSection
                  productId={product.id}
                  stockQuantity={formData.stock_quantity}
                />
              ) : (
                <div className="text-xs text-slate-400 bg-slate-950/50 border border-slate-700 rounded-lg px-3 py-2">
                  Save the product first to register its IMEI units.
                </div>
              ))}
          </div>

          <div className="shrink-0 flex justify-between items-center gap-3 px-6 py-4 border-t border-slate-700">
            <div className="flex items-center gap-2">
              {formData.barcode?.trim() && (
                <>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={printCopies}
                    onChange={(e) =>
                      setPrintCopies(
                        Math.max(1, parseInt(e.target.value, 10) || 1),
                      )
                    }
                    className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-white text-center text-sm focus:ring-2 focus:ring-violet-600"
                    title="Number of copies to print"
                  />
                  <button
                    type="button"
                    onClick={handlePrintBarcode}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <Printer size={18} />
                    Print Barcode
                  </button>
                </>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center gap-2 px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Save size={18} />
                {isLoading ? "Saving..." : "Save Product"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
