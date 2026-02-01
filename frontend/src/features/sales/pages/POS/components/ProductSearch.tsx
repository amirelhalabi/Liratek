import { useState, useEffect, useCallback } from "react";
import { Search, ShoppingCart } from "lucide-react";
import type { Product } from "../../../../../types";
import * as api from "../../../../../api/backendApi";

interface ProductSearchProps {
  onAddToCart: (product: Product) => void;
}

export default function ProductSearch({ onAddToCart }: ProductSearchProps) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProducts(search);
      setProducts(data as unknown as Product[]);
    } catch (error) {
      console.error("Error loading products:", error);
    } finally {
      setLoading(false);
    }
  }, [search]);

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
  }, [search, loadProducts]);

  return (
    <div className="flex flex-col h-full bg-slate-900/50 rounded-2xl border border-slate-700/50 overflow-hidden">
      {/* Search Header */}
      <div className="p-4 border-b border-slate-700 bg-slate-800/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="relative">
          <Search className="absolute left-4 top-3.5 text-slate-500 h-5 w-5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products by name or barcode..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-violet-600 shadow-inner"
            autoFocus
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
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((product) => (
              <button
                key={product.id}
                onClick={() => onAddToCart(product)}
                className="group relative flex flex-col items-start p-4 bg-slate-800 border border-slate-700 rounded-xl hover:border-violet-500 hover:bg-slate-750 transition-all text-left"
              >
                {/* Stock Badge - Always visible on top-left */}
                <div className="absolute top-2 left-2 z-10">
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${product.stock_quantity > 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
                  >
                    {product.stock_quantity} left
                  </span>
                </div>

                {/* Add Button - Shows on hover */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <div className="bg-violet-600 text-white text-xs px-2 py-1 rounded-full">
                    Add
                  </div>
                </div>

                {/* Placeholder Image Area */}
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

                {/* Price - Now has full width */}
                <div className="mt-auto w-full">
                  <span className="text-violet-400 font-bold text-lg">
                    ${product.retail_price.toFixed(2)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
