import { useState, useEffect, useCallback } from "react";
import logger from "@/utils/logger";
import { X, Save, Printer } from "lucide-react";
import { useApi, appEvents } from "@liratek/ui";
import type { Product } from "@liratek/ui";
import JsBarcode from "jsbarcode";

interface ProductFormProps {
  onClose: () => void;
  onSave: () => void;
  product?: Product | null;
  prefillName?: string | undefined;
  prefillBarcode?: string | undefined;
}

export default function ProductForm({
  onClose,
  onSave,
  product,
  prefillName,
  prefillBarcode,
}: ProductFormProps) {
  const api = useApi();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  const [duplicateInfo, setDuplicateInfo] = useState<null | {
    attempted: string;
    suggested: string;
  }>(null);
  const [formData, setFormData] = useState({
    barcode: prefillBarcode || "",
    name: prefillName || "",
    category: "Accessories",
    cost_price: 0,
    retail_price: 0,
    min_stock_level: 5,
    stock_quantity: 0,
    supplier: "" as string,
  });

  useEffect(() => {
    if (product) {
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
    }
  }, [product]);

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

  const [printCopies, setPrintCopies] = useState(1);

  const handlePrintBarcode = useCallback(async () => {
    const barcode = formData.barcode?.trim();
    if (!barcode) return;

    const copies = Math.max(1, Math.min(printCopies, 999));

    // Create an offscreen canvas, render the barcode, export as data URL
    const canvas = document.createElement("canvas");
    try {
      JsBarcode(canvas, barcode, {
        format: "CODE128",
        width: 1.5,
        height: 30, // rendered height before rotation
        displayValue: true,
        fontSize: 10,
        margin: 0,
        textMargin: 1,
      });
    } catch {
      logger.error("Failed to generate barcode", { barcode });
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");

    // Build label HTML — one per copy, each on its own page
    // Using a flex layout with 90deg rotation to make it print along the 58mm length.
    const labels = Array.from({ length: copies })
      .map(
        () => `<div class="label"><img src="${dataUrl}" alt="barcode" /></div>`,
      )
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
    padding: 1mm;
  }
  
  /* Barcode prints landscape — no rotation needed, image fits naturally in 58mm x 30mm */
  img { 
    max-width: 54mm;
    max-height: 26mm;
    display: block; 
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

    try {
      const payload = {
        ...formData,
        id: product?.id ?? 0,
        supplier: formData.supplier || null,
      } as any;

      let result;
      if (product) {
        result = await api.updateProduct(product.id, payload);
      } else {
        result = await api.createProduct(payload);
      }

      if (result.success) {
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

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-slate-700 bg-slate-800">
          <h2 className="text-xl font-bold text-white">
            {product ? "Edit Product" : "New Product"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
              />
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
                  setFormData((prev) => ({ ...prev, category: e.target.value }))
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
                  setFormData((prev) => ({ ...prev, supplier: e.target.value }))
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
              <input
                id="product-cost-price"
                name="cost_price"
                type="number"
                step="0.01"
                value={formData.cost_price}
                onChange={handleChange}
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
              <input
                id="product-retail-price"
                name="retail_price"
                type="number"
                step="0.01"
                value={formData.retail_price}
                onChange={handleChange}
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
          </div>

          <div className="flex justify-between items-center gap-3 mt-6 pt-4 border-t border-slate-700">
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
