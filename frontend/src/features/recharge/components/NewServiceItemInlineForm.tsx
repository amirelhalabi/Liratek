import { X } from "lucide-react";
import { DecimalInput } from "@liratek/ui";
import type { NewServiceItemForm } from "../utils/catalogNames";

interface NewServiceItemInlineFormProps {
  form: NewServiceItemForm;
  error: string;
  onChange: (form: NewServiceItemForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const INPUT_CLASS =
  "w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500";

/**
 * Admin-only inline "add item" form on the sale screen (FinancialForm for
 * WHISH_APP, KatchForm for iPick/Katsh). Shared so both screens build the
 * same item from the same fields.
 *
 * `isNewCategory` adds an editable Category field: a category has no table of
 * its own, so a new one is saved together with its first item.
 */
export function NewServiceItemInlineForm({
  form,
  error,
  onChange,
  onSubmit,
  onCancel,
}: NewServiceItemInlineFormProps) {
  return (
    <div className="mt-3 border border-slate-600/40 rounded-lg p-3 bg-slate-900/50 space-y-2">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-end gap-2 flex-wrap">
        {form.isNewCategory && (
          <div className="flex-1 min-w-24">
            <label className="text-slate-400 text-xs block mb-1">
              Category
            </label>
            <input
              autoFocus
              type="text"
              value={form.category}
              onChange={(e) => onChange({ ...form, category: e.target.value })}
              placeholder="e.g. internet"
              className={INPUT_CLASS}
            />
          </div>
        )}
        <div className="flex-1 min-w-24">
          <label className="text-slate-400 text-xs block mb-1">
            Subcategory
          </label>
          <input
            type="text"
            value={form.subcategory}
            onChange={(e) => onChange({ ...form, subcategory: e.target.value })}
            placeholder="e.g. pubg"
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex-1 min-w-24">
          <label className="text-slate-400 text-xs block mb-1">Label</label>
          <input
            autoFocus={!form.isNewCategory}
            type="text"
            value={form.label}
            onChange={(e) => onChange({ ...form, label: e.target.value })}
            placeholder="e.g. 60UC"
            className={INPUT_CLASS}
          />
        </div>
        <div className="w-28">
          <label className="text-slate-400 text-xs block mb-1">Cost</label>
          <DecimalInput
            value={parseFloat(form.cost_lbp) || 0}
            onChange={(n) =>
              onChange({ ...form, cost_lbp: n ? String(n) : "" })
            }
            placeholder="LBP"
            className={INPUT_CLASS}
          />
        </div>
        <div className="w-28">
          <label className="text-slate-400 text-xs block mb-1">Sell</label>
          <DecimalInput
            value={parseFloat(form.sell_lbp) || 0}
            onChange={(n) =>
              onChange({ ...form, sell_lbp: n ? String(n) : "" })
            }
            placeholder="LBP"
            className={INPUT_CLASS}
          />
        </div>
        <div className="w-16">
          <label className="text-slate-400 text-xs block mb-1">Order</label>
          <input
            type="number"
            value={form.sort_order}
            onChange={(e) => onChange({ ...form, sort_order: e.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        <button
          onClick={onSubmit}
          className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-medium transition-colors"
          type="button"
        >
          Add
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-colors"
          type="button"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
