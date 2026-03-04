import { useState, useEffect, useCallback, useRef } from "react";
import logger from "../../../../../utils/logger";
import { Search, ShoppingCart, Plus } from "lucide-react";
import type { Product } from "@liratek/ui";
import { useApi } from "@liratek/ui";
import { DataTable } from "@/shared/components/DataTable";

const PAGE_SIZE = 20;

function getPosShowImages(): boolean {
  return localStorage.getItem("pos_show_images") !== "false";
}

interface ProductSearchProps {
  onAddToCart: (product: Product) => void;
  onCreateProduct?: (prefillName: string) => void;
}

export default function ProductSearch({
  onAddToCart,
  onCreateProduct,
}: ProductSearchProps) {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [showImages, setShowImages] = useState(getPosShowImages);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Track whether the current search was user-initiated (not the initial empty load)
  const isUserSearch = useRef(false);
  // Timer for delayed barcode auto-add (gives time to keep typing)
  const barcodeAutoAddTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // A barcode is a purely numeric string with 6+ digits (barcode scanners input digits rapidly)
  const isBarcodeScan = (value: string) => /^\d{6,}$/.test(value.trim());

  // Cancel any pending barcode auto-add (called when user types more)
  const cancelBarcodeAutoAdd = () => {
    if (barcodeAutoAddTimer.current) {
      clearTimeout(barcodeAutoAddTimer.current);
      barcodeAutoAddTimer.current = null;
    }
  };

  // Auto-focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Cancel pending auto-add on unmount
  useEffect(() => () => cancelBarcodeAutoAdd(), []);

  // Listen for setting changes from ShopConfig
  useEffect(() => {
    const handler = () => setShowImages(getPosShowImages());
    window.addEventListener("pos-display-changed", handler);
    return () => window.removeEventListener("pos-display-changed", handler);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProducts(search);
      const results = data as unknown as Product[];
      setProducts(results);

      // Auto-add when scanning a barcode that matches exactly 1 product.
      // Delay 800ms so manual typers can keep entering digits.
      // Barcode scanners input all digits within ~50ms so the 300ms search
      // debounce + 800ms auto-add delay is still fast for scanners.
      cancelBarcodeAutoAdd();
      if (
        isUserSearch.current &&
        isBarcodeScan(search) &&
        results.length === 1
      ) {
        const product = results[0];
        barcodeAutoAddTimer.current = setTimeout(() => {
          onAddToCart(product);
          setSearch("");
          isUserSearch.current = false;
          requestAnimationFrame(() => searchInputRef.current?.focus());
        }, 800);
      }
    } catch (error) {
      logger.error("Error loading products:", error);
    } finally {
      setLoading(false);
    }
  }, [search, onAddToCart]);

  // Initial load
  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      loadProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="flex flex-col h-full bg-slate-900/50 rounded-2xl border border-slate-700/50 overflow-hidden">
      {/* Search Header */}
      <div className="p-4 border-b border-slate-700 bg-slate-800/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="relative">
          <Search className="absolute left-4 top-3.5 text-slate-500 h-5 w-5" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => {
              isUserSearch.current = true;
              cancelBarcodeAutoAdd();
              setSearch(e.target.value);
            }}
            placeholder="Search products by name or barcode..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-violet-600 shadow-inner"
          />
        </div>
      </div>

      {/* Product Grid */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500">
            Loading...
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <ShoppingCart size={48} className="mb-4 opacity-50" />
            <p>No products found</p>
            {search.trim().length > 0 && onCreateProduct && (
              <button
                onClick={() => onCreateProduct(search.trim())}
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors"
              >
                <Plus size={18} />
                Create Item
              </button>
            )}
          </div>
        ) : showImages ? (
          /* ── Image Grid View ── */
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((product) => (
              <button
                key={product.id}
                onClick={() => onAddToCart(product)}
                className="group relative flex flex-col items-start p-4 bg-slate-800 border border-slate-700 rounded-xl hover:border-violet-500 hover:bg-slate-750 transition-all text-left"
              >
                {/* Stock Badge */}
                <div className="absolute top-2 left-2 z-10">
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${(product.stock_quantity ?? 0) > 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
                  >
                    {product.stock_quantity ?? 0} left
                  </span>
                </div>
                {/* Add Button on hover */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <div className="bg-violet-600 text-white text-xs px-2 py-1 rounded-full">
                    Add
                  </div>
                </div>
                {/* Image */}
                <div className="w-full aspect-square bg-slate-700/50 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ShoppingCart className="text-slate-600" size={24} />
                  )}
                </div>
                <h3 className="font-semibold text-slate-200 line-clamp-2 mb-1">
                  {product.name}
                </h3>
                <div className="text-xs text-slate-500 mb-2">
                  {product.category}
                </div>
                <div className="mt-auto w-full">
                  <span className="text-violet-400 font-bold text-lg">
                    ${(product.retail_price ?? 0).toFixed(2)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          /* ── Table View — shared DataTable with TanStack sort + pagination ── */
          <DataTable<Product>
            columns={[
              {
                header: "Product",
                sortKey: "name",
                className:
                  "px-3 py-2 text-left text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: "Category",
                sortKey: "category",
                className:
                  "px-3 py-2 text-left text-xs font-semibold uppercase text-slate-400",
                width: "130px",
              },
              {
                header: "Stock",
                sortKey: "stock_quantity",
                className:
                  "px-3 py-2 text-right text-xs font-semibold uppercase text-slate-400",
                width: "70px",
              },
              {
                header: "Price",
                sortKey: "retail_price",
                className:
                  "px-3 py-2 text-right text-xs font-semibold uppercase text-slate-400",
                width: "80px",
              },
            ]}
            data={products}
            paginate
            pageSize={PAGE_SIZE}
            pageLabel="products"
            defaultSortKey="name"
            className="w-full text-sm"
            theadClassName="border-b border-slate-700"
            tbodyClassName="divide-y divide-slate-700/50"
            renderRow={(product) => (
              <tr
                key={product.id}
                onClick={() => onAddToCart(product)}
                className="hover:bg-slate-700/50 cursor-pointer transition-colors group"
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium text-slate-200 group-hover:text-white">
                    {product.name}
                  </div>
                  {product.barcode && (
                    <div className="text-xs text-slate-600 font-mono">
                      {product.barcode}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-xs text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded">
                    {product.category}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span
                    className={`text-xs font-medium ${(product.stock_quantity ?? 0) > 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {product.stock_quantity ?? 0}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-violet-400 font-bold">
                    ${(product.retail_price ?? 0).toFixed(2)}
                  </span>
                </td>
              </tr>
            )}
          />
        )}
      </div>
    </div>
  );
}
