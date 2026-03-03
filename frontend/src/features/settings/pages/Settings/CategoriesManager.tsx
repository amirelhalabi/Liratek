import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Check, X, Tag } from "lucide-react";
import { DataTable } from "@/shared/components/DataTable";

interface Category {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
}

export default function CategoriesManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState("");

  // ── Selection ──────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const allSelected =
    categories.length > 0 && selectedIds.size === categories.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleOne = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const load = async () => {
    setLoading(true);
    try {
      const data = await window.api?.inventory.getCategoriesFull();
      setCategories(data ?? []);
      setSelectedIds(new Set()); // clear selection on reload
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setError("");
    const res = await window.api?.inventory.createCategory(newName.trim());
    if (res?.success) {
      setNewName("");
      load();
    } else setError(res?.error ?? "Failed to create category");
  };

  const handleUpdate = async (id: number) => {
    if (!editingName.trim()) return;
    setError("");
    const res = await window.api?.inventory.updateCategory(
      id,
      editingName.trim(),
    );
    if (res?.success) {
      setEditingId(null);
      load();
    } else setError(res?.error ?? "Failed to update");
  };

  const handleDelete = async (id: number, name: string) => {
    if (
      !confirm(
        `Delete category "${name}"? Products in this category will keep their current label.`,
      )
    )
      return;
    const res = await window.api?.inventory.deleteCategory(id);
    if (res?.success) load();
    else setError(res?.error ?? "Failed to delete");
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedIds.size} selected categor${selectedIds.size === 1 ? "y" : "ies"}? Products will keep their current labels.`,
      )
    )
      return;
    setError("");
    let failed = 0;
    for (const id of selectedIds) {
      const res = await window.api?.inventory.deleteCategory(id);
      if (!res?.success) failed++;
    }
    if (failed > 0)
      setError(
        `${failed} categor${failed === 1 ? "y" : "ies"} failed to delete.`,
      );
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Tag size={16} className="text-violet-400" />
        <span className="text-sm font-semibold text-white">
          Product Categories
        </span>
        <span className="text-xs text-slate-500 ml-1">
          ({categories.length} categories)
        </span>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Add new category */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="New category name..."
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
        />
        <button
          onClick={handleAdd}
          disabled={!newName.trim()}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={15} /> Add
        </button>
      </div>

      {/* DataTable with selectAll */}
      <div className="border border-slate-700 rounded-xl overflow-hidden">
        <DataTable<Category>
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
                  onClick={handleBatchDelete}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                  Delete Selected ({selectedIds.size})
                </button>
              </div>
            ) : undefined
          }
          columns={[
            {
              header: "",
              className: "p-3 border-b border-slate-700",
              width: "44px",
            },
            {
              header: "Category Name",
              sortKey: "name",
              className: "p-3 border-b border-slate-700",
            },
            {
              header: "Actions",
              className: "p-3 border-b border-slate-700 text-right",
              width: "100px",
            },
          ]}
          data={categories}
          loading={loading}
          emptyMessage="No categories yet. Add one above."
          exportExcel
          exportPdf
          exportFilename="categories"
          defaultSortKey="sort_order"
          selectAll={{
            checked: allSelected,
            indeterminate: someSelected,
            onChange: (checked) =>
              setSelectedIds(
                checked ? new Set(categories.map((c) => c.id)) : new Set(),
              ),
          }}
          className="w-full text-left"
          theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
          tbodyClassName="divide-y divide-slate-700/50"
          renderRow={(cat) => {
            const isSelected = selectedIds.has(cat.id);
            const isEditing = editingId === cat.id;
            return (
              <tr
                key={cat.id}
                className={`transition-colors ${isSelected ? "bg-red-900/10" : "hover:bg-slate-800/50"}`}
              >
                {/* Checkbox */}
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(cat.id)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-violet-600 cursor-pointer"
                  />
                </td>

                {/* Name / edit input */}
                <td className="p-3">
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUpdate(cat.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full bg-slate-800 border border-violet-500 rounded px-2 py-1 text-white text-sm focus:outline-none"
                    />
                  ) : (
                    <span className="text-sm text-slate-200">{cat.name}</span>
                  )}
                </td>

                {/* Actions */}
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleUpdate(cat.id)}
                          className="text-emerald-400 hover:text-emerald-300 p-1.5 transition-colors"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-slate-500 hover:text-slate-300 p-1.5 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(cat.id);
                            setEditingName(cat.name);
                          }}
                          className="text-slate-400 hover:text-blue-400 p-1.5 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(cat.id, cat.name)}
                          className="text-slate-400 hover:text-red-400 p-1.5 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          }}
        />
      </div>
    </div>
  );
}
