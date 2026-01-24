import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Package, Edit2, Trash2 } from "lucide-react";
import { useAuth } from "../../../auth/context/AuthContext";
import ProductForm from "./ProductForm";
import type { Product } from "../../../../types";

export default function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      if (window.api) {
        const data = await window.api.getProducts(search);
        setProducts(data);
      } else {
        const { getProducts } = await import("../../../../api/backendApi");
        const data = await getProducts(search);
        setProducts(data as any);
      }
    } catch (error) {
      console.error("Failed to load products:", error);
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
    console.log('[DELETE] Attempting to delete product ID:', id);
    if (!confirm("Are you sure you want to delete this product?")) {
      console.log('[DELETE] User cancelled');
      return;
    }
    try {
      if (window.api) {
        console.log('[DELETE] Using window.api.deleteProduct');
        const result = await window.api.deleteProduct(id);
        console.log('[DELETE] Result:', result);
      } else {
        console.log('[DELETE] Using backend API');
        const { deleteProduct } = await import("../../../../api/backendApi");
        await deleteProduct(id);
      }
      console.log('[DELETE] Reloading products...');
      loadProducts(); // Refresh list
      console.log('[DELETE] Success!');
      alert('Product deleted successfully!');
    } catch (error) {
      console.error("[DELETE] Failed to delete:", error);
      alert("Failed to delete: " + (error instanceof Error ? error.message : String(error)));
    }
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Package className="text-violet-400" />
            Inventory
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage prodcuts, stock, and pricing
          </p>
        </div>
        <button
          onClick={() => setIsFormOpen(true)}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-violet-900/20"
        >
          <Plus size={20} />
          Add Product
        </button>
      </div>

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
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase font-semibold">
            <tr>
              <th className="p-4 border-b border-slate-700">Info</th>
              <th className="p-4 border-b border-slate-700">Category</th>
              <th className="p-4 border-b border-slate-700">Added Date</th>
              {isAdmin && (
                <th className="p-4 border-b border-slate-700">Cost</th>
              )}
              <th className="p-4 border-b border-slate-700">Retail</th>
              <th className="p-4 border-b border-slate-700">Stock</th>
              <th className="p-4 border-b border-slate-700 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700 text-sm">
            {loading ? (
              <tr>
                <td
                  colSpan={isAdmin ? 7 : 6}
                  className="p-8 text-center text-slate-500"
                >
                  Loading inventory...
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? 7 : 6}
                  className="p-8 text-center text-slate-500"
                >
                  No products found.
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr
                  key={product.id}
                  className="hover:bg-slate-700/50 transition-colors"
                >
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
                    {product.created_at
                      ? new Date(product.created_at).toLocaleDateString()
                      : "-"}
                  </td>
                  {isAdmin && (
                    <td className="p-4 text-slate-400">
                      ${product.cost_price.toFixed(2)}
                    </td>
                  )}
                  <td className="p-4 text-green-400 font-medium">
                    ${product.retail_price.toFixed(2)}
                  </td>
                  <td className="p-4">
                    <div
                      className={`font-medium ${product.stock_quantity <= product.min_stock_level ? "text-red-400" : "text-slate-300"}`}
                    >
                      {product.stock_quantity} units
                    </div>
                  </td>
                  <td className="p-4 text-right">
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
              ))
            )}
          </tbody>
        </table>
      </div>

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
