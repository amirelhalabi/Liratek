import { useState, useEffect } from "react";
import logger from "../../../../utils/logger";
import { X, Save } from "lucide-react";
import { useApi } from "@liratek/ui";
import type { Product } from "@liratek/ui";

interface ProductFormProps {
  onClose: () => void;
  onSave: () => void;
  product?: Product | null;
}

export default function ProductForm({
  onClose,
  onSave,
  product,
}: ProductFormProps) {
  const api = useApi();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [duplicateInfo, setDuplicateInfo] = useState<null | {
    attempted: string;
    suggested: string;
  }>(null);
  const [formData, setFormData] = useState({
    barcode: "",
    name: "",
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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "number" ? parseFloat(value) : value,
    }));
  };

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
              <select
                id="product-category"
                value={formData.category}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, category: e.target.value }))
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                {!categories.includes(formData.category) &&
                  formData.category && (
                    <option value={formData.category}>
                      {formData.category}
                    </option>
                  )}
              </select>
            </div>

            {/* Row 3: Supplier | Quantity */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">
                Supplier
              </label>
              <input
                type="text"
                value={formData.supplier ?? ""}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, supplier: e.target.value }))
                }
                placeholder="Supplier name (optional)"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
              />
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

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-700">
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
        </form>
      </div>
    </div>
  );
}
