import { useState, useEffect, useCallback } from "react";
import logger from "../../../../utils/logger";
import { Plus, Search, Package, Edit2, Trash2 } from "lucide-react";
import { useAuth } from "../../../auth/context/AuthContext";
import { PageHeader, useApi } from "@liratek/ui";
import ProductForm from "./ProductForm";
import type { Product } from "@liratek/ui";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";

export default function ProductList() {
  const api = useApi();
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
      <PageHeader
        icon={Package}
        title="Inventory"
        actions={
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-violet-900/20"
          >
            <Plus size={20} />
            Add Product
          </button>
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
          columns={[
            { header: "Info", className: "p-4 border-b border-slate-700" },
            { header: "Category", className: "p-4 border-b border-slate-700" },
            {
              header: "Added Date",
              className: "p-4 border-b border-slate-700",
            },
            ...(isAdmin
              ? [
                  {
                    header: "Cost",
                    className: "p-4 border-b border-slate-700",
                  } as DataTableColumn,
                ]
              : []),
            { header: "Retail", className: "p-4 border-b border-slate-700" },
            { header: "Stock", className: "p-4 border-b border-slate-700" },
            {
              header: "Actions",
              className: "p-4 border-b border-slate-700 text-right",
            },
          ]}
          data={products}
          loading={loading}
          emptyMessage="No products found."
          exportExcel
          exportPdf
          exportFilename="products"
          className="w-full text-left border-collapse"
          theadClassName="bg-slate-800/50 text-slate-400 text-xs uppercase font-semibold"
          tbodyClassName="divide-y divide-slate-700 text-sm"
          renderRow={(product) => (
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
          )}
        />
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
