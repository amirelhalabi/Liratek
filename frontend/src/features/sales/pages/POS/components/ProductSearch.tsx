import { useState, useEffect, useCallback, useRef, memo } from "react";
import logger from "@/utils/logger";
import {
  Search,
  ShoppingCart,
  Plus,
  Clock,
  User,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Product } from "@liratek/ui";
import { useApi, appEvents } from "@liratek/ui";
import { DataTable } from "@/shared/components/DataTable";

const PAGE_SIZE = 20;

function getPosShowImages(): boolean {
  return localStorage.getItem("pos_show_images") !== "false";
}

interface TodaySale {
  id: number;
  client_name: string | null;
  paid_usd: number;
  paid_lbp: number;
  final_amount_usd: number;
  discount_usd: number;
  status: string;
  item_count: number;
  created_at: string;
}

interface ProductSearchProps {
  onAddToCart: (product: Product) => void;
  onCreateProduct?: (prefill: { name?: string; barcode?: string }) => void;
  onSaleClick?: (saleId: number) => void;
  refreshSalesKey?: number;
}

function ProductSearch({
  onAddToCart,
  onCreateProduct,
  onSaleClick,
  refreshSalesKey,
}: ProductSearchProps) {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [showImages, setShowImages] = useState(getPosShowImages);
  const [todaysSales, setTodaysSales] = useState<TodaySale[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Track whether the current search was user-initiated (not the initial empty load)
  const isUserSearch = useRef(false);
  // Timer for delayed barcode auto-add (gives time to keep typing)
  const barcodeAutoAddTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Date state for searching past sales, defaults to today
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    // Return YYYY-MM-DD in local timezone
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  const getTodayStr = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const isToday = selectedDate === getTodayStr();

  // A barcode is a purely numeric string with 6+ digits (barcode scanners input digits rapidly)
  const isBarcodeScan = (value: string) => /^\d{6,}$/.test(value.trim());

  // Cancel any pending barcode auto-add (called when user types more)
  const cancelBarcodeAutoAdd = () => {
    if (barcodeAutoAddTimer.current) {
      clearTimeout(barcodeAutoAddTimer.current);
      barcodeAutoAddTimer.current = null;
    }
  };

  // Auto-focus search input on mount (with delay to ensure layout is ready)
  useEffect(() => {
    // Immediate attempt
    searchInputRef.current?.focus();
    // Delayed retry — covers cases where navigation or animation
    // temporarily prevents focus (e.g. sidebar still holds focus)
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Cancel pending auto-add on unmount
  useEffect(() => () => cancelBarcodeAutoAdd(), []);

  // Listen for setting changes from ShopConfig
  useEffect(() => {
    const handler = () => setShowImages(getPosShowImages());
    window.addEventListener("pos-display-changed", handler);
    return () => window.removeEventListener("pos-display-changed", handler);
  }, []);

  // Load sales on mount, when refreshSalesKey changes, or when selectedDate changes
  useEffect(() => {
    const loadSales = async () => {
      try {
        const data = await window.api?.sales?.getTodaysSales(selectedDate);
        setTodaysSales(Array.isArray(data) ? data : []);
      } catch {
        setTodaysSales([]);
      }
    };
    loadSales();
  }, [refreshSalesKey, selectedDate]);

  // Listen for sale:completed events to refresh sales (only if looking at today)
  useEffect(() => {
    const handler = () => {
      if (isToday) {
        (window.api?.sales?.getTodaysSales as any)?.(selectedDate)
          .then((data: TodaySale[]) => {
            setTodaysSales(Array.isArray(data) ? data : []);
          })
          .catch(() => {});
      }
    };
    const unsub = appEvents.on("sale:completed", handler);
    return unsub;
  }, [isToday, selectedDate]);

  // Clear search bar when checkout modal closes (cancel, draft, or complete)
  useEffect(() => {
    return appEvents.on("checkout:closed", () => setSearch(""));
  }, []);

  const loadProducts = useCallback(async () => {
    const searchTerm = search.trim();
    if (!searchTerm) {
      setProducts([]);
      return;
    }

    try {
      const data = await api.getProducts(search);
      const results = data as unknown as Product[];
      setProducts(results);

      // Auto-add when scanning a barcode that matches exactly 1 product.
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
    } catch (err) {
      logger.error("Error loading products:", err);
    }
  }, [search, onAddToCart, api]);

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

  const isSearchEmpty = !search.trim();

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const shiftDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  const displayDateStr = () => {
    if (isToday) return "Today's Sales";
    const [year, month, day] = selectedDate.split("-");
    return `${day}/${month}/${year}'s Sales`;
  };

  return (
    <div className="flex flex-col bg-slate-900/50 rounded-2xl border border-slate-700/50 overflow-hidden">
      {/* Search Header */}
      <div className="p-4 border-b border-slate-700 bg-slate-800/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="relative">
          <Search className="absolute left-4 top-3.5 text-slate-500 h-5 w-5" />
          <input
            ref={searchInputRef}
            autoFocus
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

      {/* Content Area */}
      <div className="min-h-0 max-h-full overflow-y-auto p-4 custom-scrollbar">
        {isSearchEmpty ? (
          /* ── Sales View ── */
          <>
            <div className="flex items-center justify-between mb-4 bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
              <div className="flex items-center gap-3">
                <Clock size={16} className="text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider min-w-[110px]">
                  {displayDateStr()}
                </h3>
                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                  {todaysSales.length}
                </span>
              </div>
              {!isToday && (
                <button
                  onClick={() => setSelectedDate(getTodayStr())}
                  className="ml-2 text-xs text-violet-400 hover:text-violet-300 font-medium"
                >
                  Today
                </button>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => shiftDate(-1)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded border border-slate-700 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  max={getTodayStr()}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300 focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={() => shiftDate(1)}
                  disabled={isToday}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:hover:bg-slate-800 text-slate-400 hover:text-white disabled:hover:text-slate-400 rounded border border-slate-700 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {todaysSales.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <ShoppingCart size={48} className="mb-4 opacity-50" />
                <p>No sales found for this date</p>
              </div>
            ) : showImages ? (
              /* ── Sales Card Grid ── */
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {todaysSales.map((sale) => (
                  <button
                    key={sale.id}
                    onClick={() => onSaleClick?.(sale.id)}
                    className={`group relative flex flex-col p-4 rounded-xl border transition-all text-left ${
                      sale.status === "refunded"
                        ? "bg-red-950/30 border-red-800/50 hover:border-red-600"
                        : "bg-slate-800 border-slate-700 hover:border-violet-500 hover:bg-slate-750"
                    }`}
                  >
                    {sale.status === "refunded" && (
                      <div className="absolute top-2 right-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium flex items-center gap-1">
                          <RotateCcw size={10} />
                          Refunded
                        </span>
                      </div>
                    )}
                    <div className="text-xs text-slate-500 mb-2">
                      {formatTime(sale.created_at)}
                    </div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <User size={12} className="text-slate-500 shrink-0" />
                      <span className="text-sm text-slate-300 truncate">
                        {sale.client_name || "Walk-in"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mb-2">
                      {sale.item_count} item{sale.item_count !== 1 ? "s" : ""}
                    </div>
                    <div className="mt-auto">
                      <span
                        className={`font-bold text-lg ${sale.status === "refunded" ? "text-red-400 line-through" : "text-emerald-400"}`}
                      >
                        ${sale.final_amount_usd.toFixed(2)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              /* ── Sales Table View ── */
              <DataTable<TodaySale>
                columns={[
                  {
                    header: "Time",
                    sortKey: "created_at" as any,
                    className:
                      "px-3 py-2 text-left text-xs font-semibold uppercase text-slate-400",
                    width: "80px",
                  },
                  {
                    header: "Customer",
                    sortKey: "client_name" as any,
                    className:
                      "px-3 py-2 text-left text-xs font-semibold uppercase text-slate-400",
                  },
                  {
                    header: "Items",
                    sortKey: "item_count" as any,
                    className:
                      "px-3 py-2 text-center text-xs font-semibold uppercase text-slate-400",
                    width: "60px",
                  },
                  {
                    header: "Total",
                    sortKey: "final_amount_usd" as any,
                    className:
                      "px-3 py-2 text-right text-xs font-semibold uppercase text-slate-400",
                    width: "90px",
                  },
                ]}
                data={todaysSales}
                paginate
                pageSize={PAGE_SIZE}
                pageLabel="sales"
                defaultSortKey={"created_at" as any}
                defaultSortDirection="desc"
                className="w-full text-sm"
                theadClassName="border-b border-slate-700"
                tbodyClassName="divide-y divide-slate-700/50"
                renderRow={(sale) => (
                  <tr
                    key={sale.id}
                    onClick={() => onSaleClick?.(sale.id)}
                    className="hover:bg-slate-700/50 cursor-pointer transition-colors group"
                  >
                    <td className="px-3 py-2.5 text-slate-400 text-xs">
                      {formatTime(sale.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-slate-200">
                        {sale.client_name || "Walk-in"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-400 text-xs">
                      {sale.item_count}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={`font-bold ${sale.status === "refunded" ? "text-red-400 line-through" : "text-emerald-400"}`}
                      >
                        ${sale.final_amount_usd.toFixed(2)}
                      </span>
                      {sale.status === "refunded" && (
                        <span className="ml-1 text-[10px] text-red-400">
                          refunded
                        </span>
                      )}
                    </td>
                  </tr>
                )}
              />
            )}
          </>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <ShoppingCart size={48} className="mb-4 opacity-50" />
            <p>No products found</p>
            {search.trim().length > 0 && onCreateProduct && (
              <button
                onClick={() => {
                  const val = search.trim();
                  if (/^\d+$/.test(val)) {
                    onCreateProduct({ barcode: val });
                  } else {
                    onCreateProduct({ name: val });
                  }
                }}
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

export default memo(ProductSearch);
